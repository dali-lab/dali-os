import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/members/lib/personal-notes.server", () => ({
  NoteForbiddenError: class NoteForbiddenError extends Error {},
  NoteNotFoundError: class NoteNotFoundError extends Error {},
}));
vi.mock("~/members/lib/personal-notes-actions.server", () => ({
  addNoteShare: vi.fn(),
  removeNoteShare: vi.fn(),
  setNoteVisibility: vi.fn(),
}));
vi.mock("../document-curation", () => ({ runSetDocumentSharing: vi.fn() }));
vi.mock("~/lib/page-sharing.server", () => ({
  listPageShares: vi.fn(),
  addPageShare: vi.fn(),
  removePageShare: vi.fn(),
  SharePrincipalError: class SharePrincipalError extends Error {},
}));
vi.mock("~/drive/lib/page-audience.server", () => ({ describePageAudience: vi.fn() }));
vi.mock("~/lib/page-share-access.server", () => ({
  requirePageShareManager: vi.fn(),
  setGeneralAccess: vi.fn(),
  setFolderScope: vi.fn(),
  notifyDocumentShared: vi.fn(),
  PageShareForbiddenError: class PageShareForbiddenError extends Error {},
  PageShareNotFoundError: class PageShareNotFoundError extends Error {},
  GeneralAccessError: class GeneralAccessError extends Error {},
}));

import { prisma } from "~/lib/db.server";
import { NoteForbiddenError } from "~/members/lib/personal-notes.server";
import { addNoteShare, removeNoteShare, setNoteVisibility } from "~/members/lib/personal-notes-actions.server";
import { runSetDocumentSharing } from "../document-curation";
import { listPageShares, addPageShare, removePageShare, SharePrincipalError } from "~/lib/page-sharing.server";
import { describePageAudience } from "~/drive/lib/page-audience.server";
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
import { SHARE_PAGE_TOOL, runGetPageShares } from "../page-sharing";
import { GET_SHARING_TOOL, runGetSharing } from "../get-sharing";

const ctx = { user: { id: "user-1" } } as never;
const run = (args: Record<string, unknown>) => SHARE_PAGE_TOOL.run(ctx, args);
const findPage = prisma.page.findUnique as unknown as ReturnType<typeof vi.fn>;

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
  findPage.mockResolvedValue({ workspaceType: "Lab" });
});

describe("share_page schema", () => {
  const props = SHARE_PAGE_TOOL.def.inputSchema.properties as Record<string, any>;

  it("takes the page actions, and nothing for files, trash or pinning", () => {
    expect(props.action.enum).toEqual(["share", "unshare", "set_general_access", "set_folder_access", "set_visibility"]);
    expect(SHARE_PAGE_TOOL.def.inputSchema.required).toEqual(["action", "pageId"]);
    expect(props.scopeKind.enum).toEqual(["Private", "Lab", "Group", "Inherit"]);
    expect(props.scopePermission.enum).toEqual(["View", "Comment", "Edit"]);
    expect(props.linkAccess.enum).toEqual(["Restricted", "LabMembers"]);
    for (const absent of ["fileId", "pinned", "permanent", "isPublic"]) expect(props[absent]).toBeUndefined();
  });

  it("requires the fields each page action needs before touching anything", async () => {
    await expect(run({ action: "share", pageId: "p1" })).rejects.toThrow(/principalType, principalId/);
    await expect(run({ action: "unshare", pageId: "p1" })).rejects.toThrow(/shareId/);
    await expect(run({ action: "set_general_access", pageId: "p1" })).rejects.toThrow(/linkAccess/);
    await expect(run({ action: "set_folder_access", pageId: "p1" })).rejects.toThrow(/scopeKind/);
    await expect(run({ action: "share", principalType: "User", principalId: "u2" })).rejects.toThrow(/pageId/);
    await expect(run({ action: "share_page", pageId: "p1" })).rejects.toBeInstanceOf(McpInvalidError);
    expect(requirePageShareManager).not.toHaveBeenCalled();
  });
});

describe("share_page", () => {
  const args = { action: "share", pageId: "p1", principalType: "User", principalId: "u2" };

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
    expect(await run({ action: "unshare", pageId: "p1", shareId: "s1" })).toEqual({ ok: true });
    expect(requirePageShareManager).toHaveBeenCalledWith("p1", "user-1");
    expect(removePageShare).toHaveBeenCalledWith("p1", "s1");
  });

  it("removes nothing for a non-manager", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareForbiddenError());
    await expect(run({ action: "unshare", pageId: "p1", shareId: "s1" })).rejects.toBeInstanceOf(
      McpForbiddenError,
    );
    expect(removePageShare).not.toHaveBeenCalled();
  });
});

describe("set_page_general_access", () => {
  it("restricts a document to the people on its share list", async () => {
    vi.mocked(setGeneralAccess).mockResolvedValue({ linkAccess: "Restricted", linkPermission: "View" });
    const res = await run({ action: "set_general_access", pageId: "p1", linkAccess: "Restricted" });
    expect(requirePageShareManager).toHaveBeenCalledWith("p1", "user-1");
    expect(setGeneralAccess).toHaveBeenCalledWith("p1", "user-1", { linkAccess: "Restricted", linkPermission: "View" });
    expect(res).toEqual({ ok: true, linkAccess: "Restricted", linkPermission: "View" });
  });

  it("opens a document to the lab at the chosen level", async () => {
    vi.mocked(setGeneralAccess).mockResolvedValue({ linkAccess: "LabMembers", linkPermission: "Comment" });
    await run({ action: "set_general_access", pageId: "p1", linkAccess: "LabMembers", linkPermission: "Comment" });
    expect(setGeneralAccess).toHaveBeenCalledWith("p1", "user-1", { linkAccess: "LabMembers", linkPermission: "Comment" });
  });

  it("refuses public, signed-in or partner links and a full-access level", async () => {
    for (const linkAccess of ["Public", "SignedIn", "Partners"]) {
      await expect(run({ action: "set_general_access", pageId: "p1", linkAccess })).rejects.toBeInstanceOf(
        McpInvalidError,
      );
    }
    await expect(
      run({ action: "set_general_access", pageId: "p1", linkAccess: "LabMembers", linkPermission: "FullAccess" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
    expect(setGeneralAccess).not.toHaveBeenCalled();
  });

  it("does not write for a non-manager", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareForbiddenError());
    await expect(
      run({ action: "set_general_access", pageId: "p1", linkAccess: "Restricted" }),
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

describe("get_sharing for a page", () => {
  it("is a read tool taking a page or a file, never both or neither", async () => {
    expect(GET_SHARING_TOOL.name).toBe("get_sharing");
    expect(GET_SHARING_TOOL.requiredScope).toBe("mcp:read");
    await expect(runGetSharing("user-1", {})).rejects.toBeInstanceOf(McpInvalidError);
    await expect(runGetSharing("user-1", { pageId: "p1", fileId: "f1" })).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("reads a page's shares when given a pageId", async () => {
    vi.mocked(listPageShares).mockResolvedValue([]);
    vi.mocked(describePageAudience).mockResolvedValue({ audience: {} as never, inherited: null });
    const res = (await runGetSharing("user-1", { pageId: "p1" })) as { page: { id: string } };
    expect(res.page.id).toBe("p1");
  });

  it("returns general access, inherited access and labelled shares for a document", async () => {
    vi.mocked(listPageShares).mockResolvedValue([
      { id: "s1", principalType: "User", principalId: "u2", permission: "View", label: "Madison Dunaway" },
    ] as never);
    vi.mocked(describePageAudience).mockResolvedValue({
      audience: {} as never,
      inherited: { folderId: "f1", title: "Staff", scopeKind: "Private", groupName: null, permission: "Edit" },
    });
    const res = await runGetPageShares("user-1", { pageId: "p1" });
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
    const res = await runGetPageShares("user-1", { pageId: "f1" });
    expect(res.folderAccess).toEqual({ scopeKind: "Private", scopeGroupId: null, scopePermission: "Edit" });
  });

  it("reports a missing or archived document as not found", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareNotFoundError());
    await expect(runGetPageShares("user-1", { pageId: "gone" })).rejects.toBeInstanceOf(McpNotFoundError);
    expect(listPageShares).not.toHaveBeenCalled();
  });

  it("refuses a non-manager without reading the share list", async () => {
    vi.mocked(requirePageShareManager).mockRejectedValue(new PageShareForbiddenError());
    await expect(runGetPageShares("user-1", { pageId: "p1" })).rejects.toBeInstanceOf(McpForbiddenError);
    expect(listPageShares).not.toHaveBeenCalled();
    expect(describePageAudience).not.toHaveBeenCalled();
  });
});

describe("share_page on a personal note", () => {
  const note = { workspaceType: "Member" };

  it("shares through the owner-only note function, not the page share gate", async () => {
    findPage.mockResolvedValue(note);
    vi.mocked(addNoteShare).mockResolvedValue({ ok: true, alreadyShared: false, changed: true } as never);
    await run({ action: "share", pageId: "n1", principalType: "Group", principalId: "g1" });
    expect(addNoteShare).toHaveBeenCalledWith("n1", "user-1", "Group", "g1");
    expect(requirePageShareManager).not.toHaveBeenCalled();
    expect(addPageShare).not.toHaveBeenCalled();
    expect(notifyDocumentShared).not.toHaveBeenCalled();
  });

  it("unshares through the note function", async () => {
    findPage.mockResolvedValue(note);
    expect(await run({ action: "unshare", pageId: "n1", shareId: "s1" })).toEqual({ ok: true });
    expect(removeNoteShare).toHaveBeenCalledWith("n1", "user-1", "s1");
    expect(removePageShare).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not the owner, as a 403", async () => {
    findPage.mockResolvedValue(note);
    vi.mocked(addNoteShare).mockRejectedValue(new NoteForbiddenError("Only the note's owner can change it"));
    await expect(run({ action: "share", pageId: "n1", principalType: "User", principalId: "u2" })).rejects.toBeInstanceOf(McpForbiddenError);
  });

  it("404s a page that doesn't exist", async () => {
    findPage.mockResolvedValue(null);
    await expect(run({ action: "share", pageId: "gone", principalType: "User", principalId: "u2" })).rejects.toBeInstanceOf(McpNotFoundError);
  });

  it("makes a note public or private through its owner-only visibility setter", async () => {
    findPage.mockResolvedValue(note);
    expect(await run({ action: "set_visibility", pageId: "n1", publicVisible: true })).toEqual({ ok: true, publicVisible: true });
    expect(setNoteVisibility).toHaveBeenCalledWith("n1", "user-1", true);
    expect(runSetDocumentSharing).not.toHaveBeenCalled();
  });

  it("has no partner visibility and needs publicVisible", async () => {
    findPage.mockResolvedValue(note);
    await expect(run({ action: "set_visibility", pageId: "n1", partnerVisible: true })).rejects.toBeInstanceOf(McpInvalidError);
    await expect(run({ action: "set_visibility", pageId: "n1" })).rejects.toBeInstanceOf(McpInvalidError);
    expect(setNoteVisibility).not.toHaveBeenCalled();
  });
});

describe("share_page set_visibility on a project page", () => {
  it("sets partner and public visibility together through the audited project path", async () => {
    vi.mocked(runSetDocumentSharing).mockResolvedValue({ ok: true, partnerVisible: true, publicVisible: false });
    await run({ action: "set_visibility", pageId: "p1", partnerVisible: true, publicVisible: false });
    expect(runSetDocumentSharing).toHaveBeenCalledWith("user-1", { pageId: "p1", partnerVisible: true, publicVisible: false });
    expect(setNoteVisibility).not.toHaveBeenCalled();
  });

  it("passes on the project gate's refusal", async () => {
    vi.mocked(runSetDocumentSharing).mockRejectedValue(Object.assign(new Error("Only Core or a member staffed on this project can curate its documents"), { status: 403 }));
    await expect(run({ action: "set_visibility", pageId: "p1", partnerVisible: true })).rejects.toMatchObject({ status: 403 });
  });
});
