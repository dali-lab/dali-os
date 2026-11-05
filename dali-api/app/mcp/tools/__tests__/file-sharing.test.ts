import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/file-sharing.server", () => ({ listFileShares: vi.fn() }));
vi.mock("~/lib/page-sharing.server", () => ({
  SharePrincipalError: class SharePrincipalError extends Error {},
}));
vi.mock("~/lib/file-share-access.server", () => ({
  requireFileShareManager: vi.fn(),
  setFileGeneralAccess: vi.fn(),
  shareFileWith: vi.fn(),
  unshareFile: vi.fn(),
  FileShareForbiddenError: class FileShareForbiddenError extends Error {},
  FileShareNotFoundError: class FileShareNotFoundError extends Error {},
  FileGeneralAccessError: class FileGeneralAccessError extends Error {},
}));

import { listFileShares } from "~/lib/file-sharing.server";
import { SharePrincipalError } from "~/lib/page-sharing.server";
import {
  requireFileShareManager,
  setFileGeneralAccess,
  shareFileWith,
  unshareFile,
  FileShareForbiddenError,
  FileShareNotFoundError,
} from "~/lib/file-share-access.server";
import { McpForbiddenError, McpInvalidError, McpNotFoundError } from "../../errors";
import { MANAGE_DOCUMENT_SHARING_TOOL } from "../faceted/manage-document-sharing";

const ctx = { user: { id: "user-1" } } as never;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("manage_document_sharing file actions", () => {
  const props = MANAGE_DOCUMENT_SHARING_TOOL.def.inputSchema.properties as Record<string, any>;

  it("keeps its name, scope and the existing actions, and only adds new ones", () => {
    expect(MANAGE_DOCUMENT_SHARING_TOOL.def.name).toBe("manage_document_sharing");
    expect(MANAGE_DOCUMENT_SHARING_TOOL.def.requiredScope).toBe("mcp:write");
    expect(MANAGE_DOCUMENT_SHARING_TOOL.def.inputSchema.required).toEqual(["action"]);
    expect(props.action.enum).toEqual([
      "set_document_sharing",
      "delete_document",
      "set_file_sharing",
      "delete_file",
      "list_file_shares",
      "share_file",
      "unshare_file",
      "set_file_link_access",
    ]);
    for (const existing of ["pageId", "partnerVisible", "publicVisible", "pinned", "fileId"]) {
      expect(props[existing]).toBeDefined();
    }
  });

  it("requires the fields each new action needs", async () => {
    await expect(MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, { action: "share_file", fileId: "f1" })).rejects.toThrow(
      /principalType, principalId/,
    );
    await expect(MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, { action: "unshare_file", fileId: "f1" })).rejects.toThrow(
      /shareId/,
    );
    await expect(
      MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, { action: "set_file_link_access", fileId: "f1" }),
    ).rejects.toThrow(/linkAccess/);
  });

  it("share_file goes through the shared grant path as the caller, tagged as MCP", async () => {
    vi.mocked(shareFileWith).mockResolvedValue({ ok: true, alreadyShared: false, changed: true });
    const res = await MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, {
      action: "share_file",
      fileId: "f1",
      principalType: "User",
      principalId: "u2",
      permission: "Edit",
    });
    expect(res).toEqual({ ok: true, alreadyShared: false, changed: true });
    expect(shareFileWith).toHaveBeenCalledWith({
      fileId: "f1",
      actorId: "user-1",
      principalType: "User",
      principalId: "u2",
      permission: "Edit",
      via: "mcp",
    });
  });

  it("share_file defaults to View and rejects a bad level or principal type", async () => {
    vi.mocked(shareFileWith).mockResolvedValue({ ok: true, alreadyShared: false, changed: true });
    await MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, {
      action: "share_file",
      fileId: "f1",
      principalType: "Group",
      principalId: "g1",
    });
    expect(vi.mocked(shareFileWith).mock.calls[0][0].permission).toBe("View");
    await expect(
      MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, {
        action: "share_file",
        fileId: "f1",
        principalType: "User",
        principalId: "u2",
        permission: "Owner",
      }),
    ).rejects.toBeInstanceOf(McpInvalidError);
    await expect(
      MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, {
        action: "share_file",
        fileId: "f1",
        principalType: "Team",
        principalId: "u2",
      }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("maps the same rejections the web route gives", async () => {
    const args = { action: "share_file", fileId: "f1", principalType: "User", principalId: "u2" };
    vi.mocked(shareFileWith).mockRejectedValueOnce(new FileShareForbiddenError());
    await expect(MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, args)).rejects.toBeInstanceOf(McpForbiddenError);
    vi.mocked(shareFileWith).mockRejectedValueOnce(new FileShareNotFoundError());
    await expect(MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, args)).rejects.toBeInstanceOf(McpNotFoundError);
    vi.mocked(shareFileWith).mockRejectedValueOnce(new SharePrincipalError("That member no longer exists"));
    await expect(MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, args)).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("unshare_file removes the grant as the caller", async () => {
    expect(
      await MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, { action: "unshare_file", fileId: "f1", shareId: "s1" }),
    ).toEqual({ ok: true });
    expect(unshareFile).toHaveBeenCalledWith({ fileId: "f1", actorId: "user-1", shareId: "s1", via: "mcp" });
  });

  it("list_file_shares is manager-gated and returns labels without internal fields", async () => {
    vi.mocked(requireFileShareManager).mockResolvedValue({
      file: { id: "f1", title: "Budget", workspaceType: "Lab" },
      owner: null,
      linkAccess: "Restricted",
      linkPermission: "View",
      inheritedAccess: { kind: "lab", name: "the Lab" },
    });
    vi.mocked(listFileShares).mockResolvedValue([
      { id: "s1", principalType: "User", principalId: "u2", permission: "View", label: "Ada", memberCount: undefined },
    ] as never);
    const res = await MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, { action: "list_file_shares", fileId: "f1" });
    expect(requireFileShareManager).toHaveBeenCalledWith("f1", "user-1");
    expect(res).toEqual({
      file: { id: "f1", title: "Budget", workspaceType: "Lab" },
      linkAccess: "Restricted",
      linkPermission: "View",
      inheritedFrom: { kind: "lab", name: "the Lab" },
      shares: [{ id: "s1", principalType: "User", principalId: "u2", label: "Ada", permission: "View" }],
    });
  });

  it("list_file_shares refuses a non-manager", async () => {
    vi.mocked(requireFileShareManager).mockRejectedValue(new FileShareForbiddenError());
    await expect(
      MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, { action: "list_file_shares", fileId: "f1" }),
    ).rejects.toBeInstanceOf(McpForbiddenError);
    expect(listFileShares).not.toHaveBeenCalled();
  });

  it("set_file_link_access gates, then sets the level", async () => {
    vi.mocked(setFileGeneralAccess).mockResolvedValue({ linkAccess: "LabMembers", linkPermission: "Comment" });
    const res = await MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, {
      action: "set_file_link_access",
      fileId: "f1",
      linkAccess: "LabMembers",
      linkPermission: "Comment",
    });
    expect(requireFileShareManager).toHaveBeenCalledWith("f1", "user-1");
    expect(setFileGeneralAccess).toHaveBeenCalledWith("f1", "user-1", {
      linkAccess: "LabMembers",
      linkPermission: "Comment",
    });
    expect(res).toEqual({ ok: true, linkAccess: "LabMembers", linkPermission: "Comment" });
  });

  it("set_file_link_access does not write for a non-manager", async () => {
    vi.mocked(requireFileShareManager).mockRejectedValue(new FileShareForbiddenError());
    await expect(
      MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, { action: "set_file_link_access", fileId: "f1", linkAccess: "LabMembers" }),
    ).rejects.toBeInstanceOf(McpForbiddenError);
    expect(setFileGeneralAccess).not.toHaveBeenCalled();
  });
});
