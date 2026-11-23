import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("../document-curation", () => ({ runSetFileSharing: vi.fn() }));
vi.mock("../page-sharing", () => ({ runGetPageShares: vi.fn() }));
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
import { runSetFileSharing } from "../document-curation";
import { SHARE_FILE_TOOL, runGetFileShares } from "../file-sharing";
import { GET_SHARING_TOOL, runGetSharing } from "../get-sharing";

const ctx = { user: { id: "user-1" } } as never;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("file sharing tools", () => {
  const props = SHARE_FILE_TOOL.def.inputSchema.properties as Record<string, any>;

  it("is a write tool with only file actions", () => {
    expect(SHARE_FILE_TOOL.def.name).toBe("share_file");
    expect(SHARE_FILE_TOOL.def.requiredScope).toBe("mcp:write");
    expect(SHARE_FILE_TOOL.def.inputSchema.required).toEqual(["action", "fileId"]);
    expect(props.action.enum).toEqual(["share", "unshare", "set_link_access", "set_partner_visibility"]);
    for (const absent of ["pageId", "publicVisible", "pinned", "scopeKind"]) expect(props[absent]).toBeUndefined();
  });

  it("requires the fields each action needs", async () => {
    await expect(SHARE_FILE_TOOL.run(ctx, { action: "share", fileId: "f1" })).rejects.toThrow(
      /principalType, principalId/,
    );
    await expect(SHARE_FILE_TOOL.run(ctx, { action: "unshare", fileId: "f1" })).rejects.toThrow(
      /shareId/,
    );
    await expect(
      SHARE_FILE_TOOL.run(ctx, { action: "set_link_access", fileId: "f1" }),
    ).rejects.toThrow(/linkAccess/);
    await expect(
      SHARE_FILE_TOOL.run(ctx, { action: "set_partner_visibility", fileId: "f1" }),
    ).rejects.toThrow(/partnerVisible/);
    await expect(SHARE_FILE_TOOL.run(ctx, { action: "set_file_partner_visibility", fileId: "f1" })).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("set_partner_visibility goes through the audited project gate as the caller", async () => {
    vi.mocked(runSetFileSharing).mockResolvedValue({ ok: true, partnerVisible: true });
    expect(await SHARE_FILE_TOOL.run(ctx, { action: "set_partner_visibility", fileId: "f1", partnerVisible: true })).toEqual({ ok: true, partnerVisible: true });
    expect(runSetFileSharing).toHaveBeenCalledWith("user-1", { fileId: "f1", partnerVisible: true });
  });

  it("set_partner_visibility passes on the project gate's refusal", async () => {
    vi.mocked(runSetFileSharing).mockRejectedValue(Object.assign(new Error("Only Core or a member staffed on this project can curate its documents"), { status: 403 }));
    await expect(SHARE_FILE_TOOL.run(ctx, { action: "set_partner_visibility", fileId: "f1", partnerVisible: true })).rejects.toMatchObject({ status: 403 });
  });

  it("share_file goes through the shared grant path as the caller, tagged as MCP", async () => {
    vi.mocked(shareFileWith).mockResolvedValue({ ok: true, alreadyShared: false, changed: true });
    const res = await SHARE_FILE_TOOL.run(ctx, {
      action: "share",
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
    await SHARE_FILE_TOOL.run(ctx, {
      action: "share",
      fileId: "f1",
      principalType: "Group",
      principalId: "g1",
    });
    expect(vi.mocked(shareFileWith).mock.calls[0][0].permission).toBe("View");
    await expect(
      SHARE_FILE_TOOL.run(ctx, {
        action: "share",
        fileId: "f1",
        principalType: "User",
        principalId: "u2",
        permission: "Owner",
      }),
    ).rejects.toBeInstanceOf(McpInvalidError);
    await expect(
      SHARE_FILE_TOOL.run(ctx, {
        action: "share",
        fileId: "f1",
        principalType: "Team",
        principalId: "u2",
      }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("maps the same rejections the web route gives", async () => {
    const args = { action: "share", fileId: "f1", principalType: "User", principalId: "u2" };
    vi.mocked(shareFileWith).mockRejectedValueOnce(new FileShareForbiddenError());
    await expect(SHARE_FILE_TOOL.run(ctx, args)).rejects.toBeInstanceOf(McpForbiddenError);
    vi.mocked(shareFileWith).mockRejectedValueOnce(new FileShareNotFoundError());
    await expect(SHARE_FILE_TOOL.run(ctx, args)).rejects.toBeInstanceOf(McpNotFoundError);
    vi.mocked(shareFileWith).mockRejectedValueOnce(new SharePrincipalError("That member no longer exists"));
    await expect(SHARE_FILE_TOOL.run(ctx, args)).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("unshare_file removes the grant as the caller", async () => {
    expect(
      await SHARE_FILE_TOOL.run(ctx, { action: "unshare", fileId: "f1", shareId: "s1" }),
    ).toEqual({ ok: true });
    expect(unshareFile).toHaveBeenCalledWith({ fileId: "f1", actorId: "user-1", shareId: "s1", via: "mcp" });
  });

  it("get_sharing reads a file's shares when given a fileId", async () => {
    vi.mocked(requireFileShareManager).mockResolvedValue({
      file: { id: "f1", title: "Budget", workspaceType: "Lab" },
      owner: null,
      linkAccess: "Restricted",
      linkPermission: "View",
      inheritedAccess: null,
    });
    vi.mocked(listFileShares).mockResolvedValue([]);
    const res = (await runGetSharing("user-1", { fileId: "f1" })) as { file: { id: string } };
    expect(res.file.id).toBe("f1");
    expect(GET_SHARING_TOOL.inputSchema.required).toBeUndefined();
  });

  it("get_sharing (file) is manager-gated and returns labels without internal fields", async () => {
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
    const res = await runGetFileShares("user-1", { fileId: "f1" });
    expect(requireFileShareManager).toHaveBeenCalledWith("f1", "user-1");
    expect(res).toEqual({
      file: { id: "f1", title: "Budget", workspaceType: "Lab" },
      linkAccess: "Restricted",
      linkPermission: "View",
      inheritedFrom: { kind: "lab", name: "the Lab" },
      shares: [{ id: "s1", principalType: "User", principalId: "u2", label: "Ada", permission: "View" }],
    });
  });

  it("get_sharing (file) refuses a non-manager", async () => {
    vi.mocked(requireFileShareManager).mockRejectedValue(new FileShareForbiddenError());
    await expect(runGetFileShares("user-1", { fileId: "f1" })).rejects.toBeInstanceOf(McpForbiddenError);
    expect(listFileShares).not.toHaveBeenCalled();
  });

  it("set_file_link_access gates, then sets the level", async () => {
    vi.mocked(setFileGeneralAccess).mockResolvedValue({ linkAccess: "LabMembers", linkPermission: "Comment" });
    const res = await SHARE_FILE_TOOL.run(ctx, {
      action: "set_link_access",
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

  it("set_file_link_access refuses a public or signed-in link", async () => {
    for (const linkAccess of ["Public", "SignedIn", "Partners"]) {
      await expect(
        SHARE_FILE_TOOL.run(ctx, { action: "set_link_access", fileId: "f1", linkAccess }),
      ).rejects.toBeInstanceOf(McpInvalidError);
    }
    expect(requireFileShareManager).not.toHaveBeenCalled();
    expect(setFileGeneralAccess).not.toHaveBeenCalled();
  });

  it("set_file_link_access does not write for a non-manager", async () => {
    vi.mocked(requireFileShareManager).mockRejectedValue(new FileShareForbiddenError());
    await expect(
      SHARE_FILE_TOOL.run(ctx, { action: "set_link_access", fileId: "f1", linkAccess: "LabMembers" }),
    ).rejects.toBeInstanceOf(McpForbiddenError);
    expect(setFileGeneralAccess).not.toHaveBeenCalled();
  });
});
