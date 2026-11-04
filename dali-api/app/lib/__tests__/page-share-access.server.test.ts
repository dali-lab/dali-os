import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    page: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    groupDefinition: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    instructorAssignment: { findFirst: vi.fn() },
    projectPartner: { findFirst: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/page-sharing.server", () => ({ sharePermissionFor: vi.fn() }));
vi.mock("~/lib/pages", () => ({ collectSubtree: vi.fn() }));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn() }));
vi.mock("~/lib/lab-documents.server", () => ({ labDocAccess: vi.fn() }));
vi.mock("~/members/lib/personal-notes.server", () => ({ noteAccess: vi.fn() }));
vi.mock("~/partners/lib/partner-access", () => ({
  activeProjectPartnerWhere: () => ({ status: "Active" }),
}));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { collectSubtree } from "~/lib/pages";
import { resolveGroupMembers } from "~/lib/groups";
import { isCore, isProjectMember } from "~/lib/roles";
import { sharePermissionFor } from "~/lib/page-sharing.server";
import { labDocAccess } from "~/lib/lab-documents.server";
import { noteAccess } from "~/members/lib/personal-notes.server";
import { logAuditEvent } from "~/lib/audit";
import { notify } from "~/lib/notify.server";
import {
  setFolderScope,
  setGeneralAccess,
  canManageSharing,
  requirePageShareManager,
  notifyDocumentShared,
  PageShareForbiddenError,
  PageShareNotFoundError,
  GeneralAccessError,
} from "~/lib/page-share-access.server";

const m = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  m.page.findUnique.mockResolvedValue({ kind: "Folder" });
  m.groupDefinition.findUnique.mockResolvedValue({ id: "grp_core" });
  m.$transaction.mockResolvedValue([]);
  vi.mocked(collectSubtree).mockResolvedValue({ ids: [], height: 0 });
});

/** The ops handed to `$transaction` — the mocked prisma methods record them. */
function restrictedIds(): string[] {
  const call = m.page.updateMany.mock.calls[0];
  return call ? call[0].where.id.in : [];
}

// A scope is a BASE grant, not a ceiling: getPageAccess ORs it with each
// page's own General access. So a child left at "Everyone in the lab" stayed
// lab-visible inside a Core folder, and sharing a folder with Core silently
// failed to make its contents confidential. The move endpoint already pushes
// Restricted down a subtree for exactly this reason.
describe("setFolderScope — narrowing a folder restricts what's already inside", () => {
  it("pushes Restricted onto every descendant when scoping to a group", async () => {
    vi.mocked(collectSubtree).mockResolvedValue({ ids: ["c1", "c2", "deep"], height: 2 });

    await setFolderScope("f1", "u1", { scopeKind: "Group", scopeGroupId: "grp_core" });

    expect(collectSubtree).toHaveBeenCalledWith("f1");
    expect(restrictedIds()).toEqual(["c1", "c2", "deep"]);
    expect(m.page.updateMany.mock.calls[0][0].data).toEqual({
      linkAccess: "Restricted",
      linkPermission: "View",
    });
  });

  it("does the same for a Private scope", async () => {
    vi.mocked(collectSubtree).mockResolvedValue({ ids: ["c1"], height: 1 });
    await setFolderScope("f1", "u1", { scopeKind: "Private" });
    expect(restrictedIds()).toEqual(["c1"]);
  });

  it("closes the folder's own link alongside the descendants", async () => {
    await setFolderScope("f1", "u1", { scopeKind: "Group", scopeGroupId: "grp_core" });
    expect(m.page.update.mock.calls[0][0].data).toMatchObject({
      scopeKind: "Group",
      scopeGroupId: "grp_core",
      linkAccess: "Restricted",
      linkPermission: "View",
    });
  });

  it("leaves descendants alone for a Lab scope — it widens nothing", async () => {
    await setFolderScope("f1", "u1", { scopeKind: "Lab" });
    expect(collectSubtree).not.toHaveBeenCalled();
    expect(m.page.updateMany).not.toHaveBeenCalled();
    // And the folder keeps whatever General access it had.
    expect(m.page.update.mock.calls[0][0].data.linkAccess).toBeUndefined();
  });

  it("leaves descendants alone when clearing the scope", async () => {
    await setFolderScope("f1", "u1", { scopeKind: null });
    expect(collectSubtree).not.toHaveBeenCalled();
    expect(m.page.updateMany).not.toHaveBeenCalled();
  });

  it("writes the folder and its subtree in one transaction", async () => {
    vi.mocked(collectSubtree).mockResolvedValue({ ids: ["c1"], height: 1 });
    await setFolderScope("f1", "u1", { scopeKind: "Group", scopeGroupId: "grp_core" });
    // Either both land or neither does — a half-applied scope is a leak.
    expect(m.$transaction).toHaveBeenCalledTimes(1);
    expect(m.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("skips the updateMany entirely for an empty folder", async () => {
    await setFolderScope("f1", "u1", { scopeKind: "Group", scopeGroupId: "grp_core" });
    expect(m.$transaction.mock.calls[0][0]).toHaveLength(1);
  });

  it("refuses a non-folder", async () => {
    m.page.findUnique.mockResolvedValue({ kind: "FreeForm" });
    await expect(
      setFolderScope("p1", "u1", { scopeKind: "Group", scopeGroupId: "grp_core" }),
    ).rejects.toThrow(/only folders/i);
  });

  it("refuses a Group scope with no group", async () => {
    await expect(setFolderScope("f1", "u1", { scopeKind: "Group" })).rejects.toThrow(/pick a group/i);
  });
});

// A Drive root's visibility decides who sees the whole space, so its sharing is
// the one thing that cannot be narrowed away from Core or opened to the world.
describe("Drive roots keep a group that includes Core", () => {
  const rootPage = { kind: "Folder", folderType: "Root" };

  beforeEach(() => {
    m.page.findUnique.mockResolvedValue(rootPage);
    m.groupDefinition.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where.systemKey === "core" ? { id: "grp_core" } : { id: where.id }),
    );
    vi.mocked(resolveGroupMembers).mockImplementation(async (id: string) =>
      id === "grp_core" ? ["a", "b"] : id === "grp_wide" ? ["a", "b", "c"] : ["a"],
    );
  });

  it("accepts the Core group itself", async () => {
    await expect(
      setFolderScope("root", "u1", { scopeKind: "Group", scopeGroupId: "grp_core" }),
    ).resolves.toMatchObject({ scopeKind: "Group", scopeGroupId: "grp_core" });
  });

  it("accepts a group whose members are a superset of Core", async () => {
    await expect(
      setFolderScope("root", "u1", { scopeKind: "Group", scopeGroupId: "grp_wide" }),
    ).resolves.toMatchObject({ scopeGroupId: "grp_wide" });
  });

  it("refuses a group that leaves a Core member out", async () => {
    await expect(
      setFolderScope("root", "u1", { scopeKind: "Group", scopeGroupId: "grp_narrow" }),
    ).rejects.toThrow("A Drive root stays shared with a group that includes Core");
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("refuses when the Core group is missing", async () => {
    m.groupDefinition.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where.systemKey === "core" ? null : { id: where.id }),
    );
    await expect(
      setFolderScope("root", "u1", { scopeKind: "Group", scopeGroupId: "grp_wide" }),
    ).rejects.toThrow(/includes Core/);
  });

  it.each([["Lab"], ["Private"]] as const)("refuses a %s scope", async (scopeKind) => {
    await expect(setFolderScope("root", "u1", { scopeKind })).rejects.toThrow(/includes Core/);
  });

  it("refuses clearing the scope", async () => {
    await expect(setFolderScope("root", "u1", { scopeKind: null })).rejects.toThrow(/includes Core/);
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("does not apply the rule to an ordinary folder", async () => {
    m.page.findUnique.mockResolvedValue({ kind: "Folder", folderType: null });
    await expect(setFolderScope("f1", "u1", { scopeKind: "Private" })).resolves.toMatchObject({
      scopeKind: "Private",
    });
    expect(resolveGroupMembers).not.toHaveBeenCalled();
  });
});

describe("setGeneralAccess — Drive roots", () => {
  beforeEach(() => {
    m.page.update.mockResolvedValue({});
  });

  it("refuses Public on a root", async () => {
    m.page.findUnique.mockResolvedValue({ folderType: "Root" });
    await expect(
      setGeneralAccess("root", "u1", { linkAccess: "Public", linkPermission: "View" }),
    ).rejects.toThrow("A Drive root can't be shared publicly");
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("allows lab-wide access on a root (Core widening it)", async () => {
    m.page.findUnique.mockResolvedValue({ folderType: "Root" });
    await expect(
      setGeneralAccess("root", "u1", { linkAccess: "LabMembers", linkPermission: "View" }),
    ).resolves.toEqual({ linkAccess: "LabMembers", linkPermission: "View" });
  });

  it("allows Public on an ordinary page", async () => {
    m.page.findUnique.mockResolvedValue({ folderType: null });
    await expect(
      setGeneralAccess("p1", "u1", { linkAccess: "Public", linkPermission: "View" }),
    ).resolves.toEqual({ linkAccess: "Public", linkPermission: "View" });
  });
});

describe("setGeneralAccess — invariants", () => {
  beforeEach(() => {
    m.page.findUnique.mockResolvedValue({ folderType: null });
    m.page.update.mockResolvedValue({});
  });

  it("refuses a link that grants full access, before touching the page", async () => {
    await expect(
      setGeneralAccess("p1", "u1", { linkAccess: "LabMembers", linkPermission: "FullAccess" }),
    ).rejects.toBeInstanceOf(GeneralAccessError);
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("forces a Public link to view-only whatever role was asked for", async () => {
    await expect(
      setGeneralAccess("p1", "u1", { linkAccess: "Public", linkPermission: "Edit" }),
    ).resolves.toEqual({ linkAccess: "Public", linkPermission: "View" });
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { linkAccess: "Public", linkPermission: "View" },
    });
  });

  it("resets a Restricted page's stale higher role to View", async () => {
    await setGeneralAccess("p1", "u1", { linkAccess: "Restricted", linkPermission: "Edit" });
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { linkAccess: "Restricted", linkPermission: "View" },
    });
  });

  it("keeps the chosen role for lab-wide and signed-in links", async () => {
    await expect(
      setGeneralAccess("p1", "u1", { linkAccess: "LabMembers", linkPermission: "Comment" }),
    ).resolves.toEqual({ linkAccess: "LabMembers", linkPermission: "Comment" });
    await expect(
      setGeneralAccess("p1", "u1", { linkAccess: "SignedIn", linkPermission: "Edit" }),
    ).resolves.toEqual({ linkAccess: "SignedIn", linkPermission: "Edit" });
  });

  it("audits the change with the actor and the stored values", async () => {
    await setGeneralAccess("p1", "actor", { linkAccess: "Public", linkPermission: "Edit" });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "page.general-access",
      userId: "actor",
      targetId: "p1",
      metadata: { linkAccess: "Public", linkPermission: "View" },
    });
  });
});

describe("setFolderScope — stored values", () => {
  beforeEach(() => {
    m.page.update.mockResolvedValue({});
  });

  it("clears every scope column when scopeKind is null", async () => {
    await expect(setFolderScope("f1", "u1", { scopeKind: null })).resolves.toEqual({
      scopeKind: null,
      scopeGroupId: null,
      scopePermission: null,
    });
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { scopeKind: null, scopeGroupId: null, scopePermission: null },
    });
  });

  it("defaults a Lab scope to View and other scopes to Edit", async () => {
    expect((await setFolderScope("f1", "u1", { scopeKind: "Lab" })).scopePermission).toBe("View");
    expect((await setFolderScope("f1", "u1", { scopeKind: "Private" })).scopePermission).toBe("Edit");
  });

  it("downgrades a requested FullAccess base grant to Edit", async () => {
    const out = await setFolderScope("f1", "u1", { scopeKind: "Private", scopePermission: "FullAccess" });
    expect(out.scopePermission).toBe("Edit");
  });

  it("refuses an unknown group", async () => {
    m.groupDefinition.findUnique.mockResolvedValue(null);
    await expect(
      setFolderScope("f1", "u1", { scopeKind: "Group", scopeGroupId: "nope" }),
    ).rejects.toThrow("Unknown group");
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("throws not-found for a missing page", async () => {
    m.page.findUnique.mockResolvedValue(null);
    await expect(setFolderScope("gone", "u1", { scopeKind: "Lab" })).rejects.toBeInstanceOf(
      PageShareNotFoundError,
    );
  });

  it("ignores a stray group id on a non-Group scope", async () => {
    const out = await setFolderScope("f1", "u1", { scopeKind: "Lab", scopeGroupId: "g1" });
    expect(out.scopeGroupId).toBeNull();
  });
});

describe("canManageSharing — who may change a page's sharing", () => {
  const page = (over: Record<string, unknown>) =>
    ({ id: "p1", workspaceType: "Lab", workspaceId: null, createdById: "creator", ...over }) as never;

  beforeEach(() => {
    vi.mocked(sharePermissionFor).mockResolvedValue(null as never);
    vi.mocked(labDocAccess).mockResolvedValue({ canManageAccess: false } as never);
    vi.mocked(noteAccess).mockResolvedValue({ isOwner: false } as never);
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    m.instructorAssignment.findFirst.mockResolvedValue(null);
  });

  it("Lab: allows whoever labDocAccess lets manage access, and asks with the page's creator", async () => {
    vi.mocked(labDocAccess).mockResolvedValue({ canManageAccess: true } as never);
    expect(await canManageSharing(page({}), "u1")).toBe(true);
    expect(labDocAccess).toHaveBeenCalledWith({ id: "p1", createdById: "creator" }, "u1");
  });

  it("Lab: refuses someone labDocAccess does not allow", async () => {
    expect(await canManageSharing(page({}), "u1")).toBe(false);
  });

  it("Member: only the note's owner", async () => {
    vi.mocked(noteAccess).mockResolvedValue({ isOwner: true } as never);
    expect(await canManageSharing(page({ workspaceType: "Member", workspaceId: "u1" }), "u1")).toBe(true);
    vi.mocked(noteAccess).mockResolvedValue({ isOwner: false } as never);
    expect(await canManageSharing(page({ workspaceType: "Member", workspaceId: "u1" }), "u2")).toBe(false);
  });

  it("Project: Core or a project member, nobody else", async () => {
    const p = page({ workspaceType: "Project", workspaceId: "proj" });
    expect(await canManageSharing(p, "u1")).toBe(false);
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await canManageSharing(p, "u1")).toBe(true);
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    expect(await canManageSharing(p, "u1")).toBe(true);
    expect(isProjectMember).toHaveBeenCalledWith("u1", "proj");
  });

  it("Project doc with no project id is not manageable by role", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await canManageSharing(page({ workspaceType: "Project", workspaceId: null }), "u1")).toBe(false);
  });

  it("Education: Core or an instructor of that offering, nobody else", async () => {
    const p = page({ workspaceType: "EducationOffering", workspaceId: "off1" });
    expect(await canManageSharing(p, "u1")).toBe(false);
    expect(m.instructorAssignment.findFirst).toHaveBeenCalledWith({
      where: { userId: "u1", offeringId: "off1" },
      select: { id: true },
    });
    m.instructorAssignment.findFirst.mockResolvedValue({ id: "ia" });
    expect(await canManageSharing(p, "u1")).toBe(true);
    m.instructorAssignment.findFirst.mockResolvedValue(null);
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await canManageSharing(p, "u1")).toBe(true);
  });

  it("a FullAccess grantee may re-share in any workspace", async () => {
    vi.mocked(sharePermissionFor).mockResolvedValue("FullAccess" as never);
    expect(await canManageSharing(page({}), "u1")).toBe(true);
    expect(sharePermissionFor).toHaveBeenCalledWith("p1", "u1");
  });

  it("an Edit grantee may not re-share", async () => {
    vi.mocked(sharePermissionFor).mockResolvedValue("Edit" as never);
    expect(await canManageSharing(page({}), "u1")).toBe(false);
  });
});

describe("requirePageShareManager", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "p1",
    title: "Plan",
    kind: "Doc",
    workspaceType: "Lab",
    workspaceId: null,
    createdById: "creator",
    archivedAt: null,
    profileVisible: false,
    labListing: "Listed",
    partnerVisible: false,
    publicVisible: false,
    studentEditable: false,
    linkAccess: "Restricted",
    linkPermission: "View",
    scopeKind: null,
    scopeGroupId: null,
    scopePermission: null,
    ...over,
  });

  beforeEach(() => {
    vi.mocked(sharePermissionFor).mockResolvedValue(null as never);
    vi.mocked(labDocAccess).mockResolvedValue({ canManageAccess: true } as never);
    m.user.findUnique.mockResolvedValue({ id: "creator", firstName: "Ada", lastName: "Lovelace" });
  });

  it("404s for a missing page and for an archived page", async () => {
    m.page.findUnique.mockResolvedValue(null);
    await expect(requirePageShareManager("p1", "u1")).rejects.toBeInstanceOf(PageShareNotFoundError);
    m.page.findUnique.mockResolvedValue(row({ archivedAt: new Date() }));
    await expect(requirePageShareManager("p1", "u1")).rejects.toBeInstanceOf(PageShareNotFoundError);
  });

  it("403s a user who cannot manage the page and loads no owner for them", async () => {
    m.page.findUnique.mockResolvedValue(row());
    vi.mocked(labDocAccess).mockResolvedValue({ canManageAccess: false } as never);
    await expect(requirePageShareManager("p1", "u1")).rejects.toBeInstanceOf(PageShareForbiddenError);
    expect(m.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns the dialog context with the creator as owner", async () => {
    m.page.findUnique.mockResolvedValue(row({ linkAccess: "LabMembers", linkPermission: "Comment" }));
    const ctx = await requirePageShareManager("p1", "creator");
    expect(ctx).toMatchObject({
      page: { id: "p1", title: "Plan", kind: "Doc", workspaceType: "Lab", workspaceId: null },
      owner: { id: "creator", name: "Ada Lovelace", isYou: true },
      linkAccess: "LabMembers",
      linkPermission: "Comment",
      hasActivePartner: false,
    });
    expect(m.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "creator" } }));
  });

  it("marks the owner as not-you for another manager", async () => {
    m.page.findUnique.mockResolvedValue(row());
    expect((await requirePageShareManager("p1", "someone-else")).owner?.isYou).toBe(false);
  });

  it("names a Member note's owner by the workspace id, not the creator", async () => {
    m.page.findUnique.mockResolvedValue(row({ workspaceType: "Member", workspaceId: "owner-1" }));
    vi.mocked(noteAccess).mockResolvedValue({ isOwner: true } as never);
    m.user.findUnique.mockResolvedValue({ id: "owner-1", firstName: "Grace", lastName: "" });
    const ctx = await requirePageShareManager("p1", "owner-1");
    expect(m.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "owner-1" } }));
    expect(ctx.owner).toEqual({ id: "owner-1", name: "Grace", isYou: true });
  });

  it("has no owner when the creator is gone", async () => {
    m.page.findUnique.mockResolvedValue(row({ createdById: null }));
    expect((await requirePageShareManager("p1", "u1")).owner).toBeNull();
    expect(m.user.findUnique).not.toHaveBeenCalled();
  });

  it("reports an active partner only for a Project doc whose project has one", async () => {
    m.page.findUnique.mockResolvedValue(row({ workspaceType: "Project", workspaceId: "proj" }));
    vi.mocked(isCore).mockResolvedValue(true);
    m.projectPartner.findFirst.mockResolvedValue({ id: "pp" });
    expect((await requirePageShareManager("p1", "u1")).hasActivePartner).toBe(true);
    expect(m.projectPartner.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "proj", status: "Active" } }),
    );
    m.projectPartner.findFirst.mockResolvedValue(null);
    expect((await requirePageShareManager("p1", "u1")).hasActivePartner).toBe(false);
  });
});

describe("notifyDocumentShared", () => {
  it("notifies only the recipient, attributed to the actor, linking to the document", async () => {
    await notifyDocumentShared({ pageId: "p1", pageTitle: "Plan", recipientUserId: "u2", actorId: "u1" });
    expect(notify).toHaveBeenCalledWith({
      eventType: "document.shared_with_you",
      createdByUserId: "u1",
      message: { vars: { itemTitle: "Plan" }, link: "/documents/p1" },
      recipients: [{ userId: "u2" }],
    });
  });
});
