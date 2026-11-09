import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/file-sharing.server", () => ({ listFileShares: vi.fn() }));
vi.mock("~/lib/file-share-access.server", () => ({
  requireFileShareManager: vi.fn(),
  setFileGeneralAccess: vi.fn(),
  shareFileWith: vi.fn(),
  unshareFile: vi.fn(),
  FileShareForbiddenError: class FileShareForbiddenError extends Error {},
  FileShareNotFoundError: class FileShareNotFoundError extends Error {},
  FileGeneralAccessError: class FileGeneralAccessError extends Error {},
}));
vi.mock("~/lib/page-sharing.server", () => ({
  listPageShares: vi.fn(),
  addPageShare: vi.fn(),
  removePageShare: vi.fn(),
  SharePrincipalError: class SharePrincipalError extends Error {},
}));
vi.mock("~/lib/page-audience.server", () => ({ describePageAudience: vi.fn() }));
vi.mock("~/lib/page-share-access.server", () => ({
  requirePageShareManager: vi.fn(),
  setGeneralAccess: vi.fn(),
  setFolderScope: vi.fn(),
  notifyDocumentShared: vi.fn(),
  PageShareForbiddenError: class PageShareForbiddenError extends Error {},
  PageShareNotFoundError: class PageShareNotFoundError extends Error {},
  GeneralAccessError: class GeneralAccessError extends Error {},
}));

import { listPageShares, addPageShare, removePageShare, SharePrincipalError } from "~/lib/page-sharing.server";
import { describePageAudience } from "~/lib/page-audience.server";
import {
  requirePageShareManager,
  setGeneralAccess,
  setFolderScope,
  notifyDocumentShared,
  PageShareForbiddenError,
  PageShareNotFoundError,
  GeneralAccessError,
} from "~/lib/page-share-access.server";
import { McpForbiddenError, McpInvalidError, McpNotFoundError } from "../../errors";
import { MANAGE_DOCUMENT_SHARING_TOOL } from "../faceted/manage-document-sharing";
import { LIST_PAGE_SHARES_TOOL, runListPageShares } from "../page-sharing";

const ctx = { user: { id: "user-1" } } as never;
const run = (args: Record<string, unknown>) => MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, args);

function managerContext(kind = "FreeForm", overrides: Record<string, unknown> = {}) {
  return {
    page: { id: "p1", title: "Contacts", kind, workspaceType: "Lab", workspaceId: null },
    owner: { id: "user-1", name: "Tim Tregubov", isYou: true },
    hasActivePartner: false,
    scopeKind: null,
    scopeGroupId: null,
    scopePermission: null,
    linkAccess: "LabMembers",
    linkPermission: "View",
    profileVisible: false,
    labListing: "Listed",
    partnerVisible: false,
    publicVisible: false,
    studentEditable: false,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePageShareManager).mockResolvedValue(managerContext());
});

describe("manage_document_sharing page actions: schema", () => {
  const props = MANAGE_DOCUMENT_SHARING_TOOL.def.inputSchema.properties as Record<string, any>;

  it("adds folder access fields without dropping the file sharing ones", () => {
    expect(props.scopeKind.enum).toEqual(["Private", "Lab", "Group", "Inherit"]);
    expect(props.scopePermission.enum).toEqual(["View", "Comment", "Edit"]);
    expect(props.scopeGroupId).toBeDefined();
    expect(props.linkAccess.enum).toEqual(["Restricted", "LabMembers"]);
    for (const shared of ["principalType", "principalId", "permission", "shareId", "linkPermission", "fileId"]) {
      expect(props[shared]).toBeDefined();
    }
  });

  it("requires the fields each page action needs before touching anything", async () => {
    await expect(run({ action: "share_page", pageId: "p1" })).rejects.toThrow(/principalType, principalId/);
    await expect(run({ action: "unshare_page", pageId: "p1" })).rejects.toThrow(/shareId/);
    await expect(run({ action: "set_page_general_access", pageId: "p1" })).rejects.toThrow(/linkAccess/);
    await expect(run({ action: "set_folder_access", pageId: "p1" })).rejects.toThrow(/scopeKind/);
    await expect(run({ action: "share_page", principalType: "User", principalId: "u2" })).rejects.toThrow(/pageId/);
    expect(requirePageShareManager).not.toHaveBeenCalled();
  });
});

describe("share_page", () => {
  const args = { action: "share_page", pageId: "p1", principalType: "User", principalId: "u2" };

  it("gates on the caller, grants View by default and notifies the person", async () => {
    vi.mocked(addPageShare).mockResolvedValue({ ok: true, alreadyShared: false, changed: true });
    expect(await run(args)).toEqual({ ok: true, alreadyShared: false, changed: true });
    expect(requirePageShareManager).toHaveBeenCalledWith("p1", "user-1");
    expect(addPageShare).toHaveBeenCalledWith("p1", "user-1", "User", "u2", "View");
    expect(notifyDocumentShared).toHaveBeenCalledWith({
      pageId: "p1",
      pageTitle: "Contacts",
      recipientUserId: "u2",
      actorId: "user-1",
    });
  });

  it("passes the chosen level through", async () => {
    vi.mocked(addPageShare).mockResolvedValue({ ok: true, alreadyShared: false, changed: true });
    await run({ ...args, permission: "Edit" });
    expect(addPageShare).toHaveBeenCalledWith("p1", "user-1", "User", "u2", "Edit");
  });

  it("does not notify for a group, for yourself, or when nothing changed", async () => {
    vi.mocked(addPageShare).mockResolvedValue({ ok: true, alreadyShared: false, changed: true });
    await run({ ...args, principalType: "Group", principalId: "g1" });
    await run({ ...args, principalId: "user-1" });
    vi.mocked(addPageShare).mockResolvedValue({ ok: true, alreadyShared: true, changed: false });
    await run(args);
    expect(addPageShare).toHaveBeenCalledTimes(3);
    expect(notifyDocumentShared).not.toHaveBeenCalled();
  });

  it("rejects a bad level or principal type without gating or writing", async () => {
    await expect(run({ ...args, permission: "Owner" })).rejects.toBeInstanceOf(McpInvalidError);
    await expect(run({ ...args, principalType: "Team" })).rejects.toBeInstanceOf(McpInvalidError);
    expect(requirePageShareManager).not.toHaveBeenCalled();
    expect(addPageShare).not.toHaveBeenCalled();
  });

  it("writes nothing when the caller can't manage the document", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareForbiddenError());
    await expect(run(args)).rejects.toBeInstanceOf(McpForbiddenError);
    expect(addPageShare).not.toHaveBeenCalled();
    expect(notifyDocumentShared).not.toHaveBeenCalled();
  });

  it("maps a missing document and an unknown member the way the web route does", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValueOnce(new PageShareNotFoundError());
    await expect(run(args)).rejects.toBeInstanceOf(McpNotFoundError);
    vi.mocked(addPageShare).mockRejectedValueOnce(new SharePrincipalError("That member no longer exists"));
    await expect(run(args)).rejects.toBeInstanceOf(McpInvalidError);
  });
});

describe("unshare_page", () => {
  it("removes the share scoped to the page", async () => {
    expect(await run({ action: "unshare_page", pageId: "p1", shareId: "s1" })).toEqual({ ok: true });
    expect(requirePageShareManager).toHaveBeenCalledWith("p1", "user-1");
    expect(removePageShare).toHaveBeenCalledWith("p1", "s1");
  });

  it("removes nothing for a non-manager", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareForbiddenError());
    await expect(run({ action: "unshare_page", pageId: "p1", shareId: "s1" })).rejects.toBeInstanceOf(
      McpForbiddenError,
    );
    expect(removePageShare).not.toHaveBeenCalled();
  });
});

describe("set_page_general_access", () => {
  it("restricts a document to the people on its share list", async () => {
    vi.mocked(setGeneralAccess).mockResolvedValue({ linkAccess: "Restricted", linkPermission: "View" });
    const res = await run({ action: "set_page_general_access", pageId: "p1", linkAccess: "Restricted" });
    expect(requirePageShareManager).toHaveBeenCalledWith("p1", "user-1");
    expect(setGeneralAccess).toHaveBeenCalledWith("p1", "user-1", { linkAccess: "Restricted", linkPermission: "View" });
    expect(res).toEqual({ ok: true, linkAccess: "Restricted", linkPermission: "View" });
  });

  it("opens a document to the lab at the chosen level", async () => {
    vi.mocked(setGeneralAccess).mockResolvedValue({ linkAccess: "LabMembers", linkPermission: "Comment" });
    await run({ action: "set_page_general_access", pageId: "p1", linkAccess: "LabMembers", linkPermission: "Comment" });
    expect(setGeneralAccess).toHaveBeenCalledWith("p1", "user-1", { linkAccess: "LabMembers", linkPermission: "Comment" });
  });

  it("refuses public, signed-in or partner links and a full-access level", async () => {
    for (const linkAccess of ["Public", "SignedIn", "Partners"]) {
      await expect(run({ action: "set_page_general_access", pageId: "p1", linkAccess })).rejects.toBeInstanceOf(
        McpInvalidError,
      );
    }
    await expect(
      run({ action: "set_page_general_access", pageId: "p1", linkAccess: "LabMembers", linkPermission: "FullAccess" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
    expect(setGeneralAccess).not.toHaveBeenCalled();
  });

  it("does not write for a non-manager", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareForbiddenError());
    await expect(
      run({ action: "set_page_general_access", pageId: "p1", linkAccess: "Restricted" }),
    ).rejects.toBeInstanceOf(McpForbiddenError);
    expect(setGeneralAccess).not.toHaveBeenCalled();
  });
});

describe("set_folder_access", () => {
  it("makes a folder private", async () => {
    vi.mocked(setFolderScope).mockResolvedValue({ scopeKind: "Private", scopeGroupId: null, scopePermission: "Edit" });
    const res = await run({ action: "set_folder_access", pageId: "f1", scopeKind: "Private" });
    expect(requirePageShareManager).toHaveBeenCalledWith("f1", "user-1");
    expect(setFolderScope).toHaveBeenCalledWith("f1", "user-1", {
      scopeKind: "Private",
      scopeGroupId: null,
      scopePermission: null,
    });
    expect(res).toEqual({ ok: true, scopeKind: "Private", scopeGroupId: null, scopePermission: "Edit" });
  });

  it("scopes a folder to a group at the chosen level", async () => {
    vi.mocked(setFolderScope).mockResolvedValue({ scopeKind: "Group", scopeGroupId: "g1", scopePermission: "View" });
    await run({ action: "set_folder_access", pageId: "f1", scopeKind: "Group", scopeGroupId: "g1", scopePermission: "View" });
    expect(setFolderScope).toHaveBeenCalledWith("f1", "user-1", {
      scopeKind: "Group",
      scopeGroupId: "g1",
      scopePermission: "View",
    });
  });

  it("Inherit clears the folder's own access and ignores a stray group id", async () => {
    vi.mocked(setFolderScope).mockResolvedValue({ scopeKind: null, scopeGroupId: null, scopePermission: null });
    await run({ action: "set_folder_access", pageId: "f1", scopeKind: "Inherit", scopeGroupId: "g1" });
    expect(setFolderScope).toHaveBeenCalledWith("f1", "user-1", {
      scopeKind: null,
      scopeGroupId: null,
      scopePermission: null,
    });
  });

  it("rejects a group scope with no group, an unknown kind and a full-access level", async () => {
    await expect(run({ action: "set_folder_access", pageId: "f1", scopeKind: "Group" })).rejects.toThrow(/scopeGroupId/);
    await expect(run({ action: "set_folder_access", pageId: "f1", scopeKind: "Everyone" })).rejects.toBeInstanceOf(
      McpInvalidError,
    );
    await expect(
      run({ action: "set_folder_access", pageId: "f1", scopeKind: "Private", scopePermission: "FullAccess" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
    expect(requirePageShareManager).not.toHaveBeenCalled();
    expect(setFolderScope).not.toHaveBeenCalled();
  });

  it("passes on the server's own refusals, such as a non-folder", async () => {
    vi.mocked(setFolderScope).mockRejectedValue(new GeneralAccessError("Only folders have folder access"));
    await expect(run({ action: "set_folder_access", pageId: "p1", scopeKind: "Private" })).rejects.toThrow(
      /Only folders have folder access/,
    );
    await expect(run({ action: "set_folder_access", pageId: "p1", scopeKind: "Private" })).rejects.toBeInstanceOf(
      McpInvalidError,
    );
  });

  it("does not write for a non-manager", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareForbiddenError());
    await expect(run({ action: "set_folder_access", pageId: "f1", scopeKind: "Private" })).rejects.toBeInstanceOf(
      McpForbiddenError,
    );
    expect(setFolderScope).not.toHaveBeenCalled();
  });
});

describe("list_page_shares", () => {
  it("is a read tool that takes only a pageId", () => {
    expect(LIST_PAGE_SHARES_TOOL.name).toBe("list_page_shares");
    expect(LIST_PAGE_SHARES_TOOL.requiredScope).toBe("mcp:read");
    expect(LIST_PAGE_SHARES_TOOL.inputSchema.required).toEqual(["pageId"]);
  });

  it("returns general access, inherited access and labelled shares for a document", async () => {
    vi.mocked(listPageShares).mockResolvedValue([
      { id: "s1", principalType: "User", principalId: "u2", permission: "View", label: "Madison Dunaway" },
    ] as never);
    vi.mocked(describePageAudience).mockResolvedValue({
      audience: {} as never,
      inherited: { folderId: "f1", title: "Staff", scopeKind: "Private", groupName: null, permission: "Edit" },
    });
    const res = await runListPageShares("user-1", { pageId: "p1" });
    expect(requirePageShareManager).toHaveBeenCalledWith("p1", "user-1");
    expect(describePageAudience).toHaveBeenCalledWith("user-1", "p1");
    expect(res).toEqual({
      page: { id: "p1", title: "Contacts", kind: "FreeForm", workspaceType: "Lab", workspaceId: null },
      owner: { id: "user-1", name: "Tim Tregubov" },
      linkAccess: "LabMembers",
      linkPermission: "View",
      folderAccess: null,
      inheritedFrom: { folderId: "f1", title: "Staff", scopeKind: "Private", groupName: null, permission: "Edit" },
      shares: [{ id: "s1", principalType: "User", principalId: "u2", label: "Madison Dunaway", permission: "View" }],
    });
  });

  it("includes the folder's own access for a folder", async () => {
    vi.mocked(requirePageShareManager).mockResolvedValue(
      managerContext("Folder", { scopeKind: "Private", scopePermission: "Edit" }),
    );
    vi.mocked(listPageShares).mockResolvedValue([]);
    vi.mocked(describePageAudience).mockResolvedValue({ audience: {} as never, inherited: null });
    const res = await runListPageShares("user-1", { pageId: "f1" });
    expect(res.folderAccess).toEqual({ scopeKind: "Private", scopeGroupId: null, scopePermission: "Edit" });
  });

  it("refuses a non-manager without reading the share list", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareForbiddenError());
    await expect(runListPageShares("user-1", { pageId: "p1" })).rejects.toBeInstanceOf(McpForbiddenError);
    expect(listPageShares).not.toHaveBeenCalled();
    expect(describePageAudience).not.toHaveBeenCalled();
  });
});
