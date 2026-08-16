import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findUnique: vi.fn() },
    instructorAssignment: { findFirst: vi.fn() },
    // sharePermissionFor / isSharedWith resolve group membership and named
    // shares against these; default to "no groups, no shares".
    groupDefinition: { findMany: vi.fn() },
    pageShare: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("~/lib/roles", () => ({
  isCore: vi.fn().mockResolvedValue(false),
  isProjectMember: vi.fn().mockResolvedValue(false),
  isLabMember: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/partners/lib/partner-access", () => ({
  partnerHasProjectAccess: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/groups", () => ({
  resolveGroupMembers: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { resolveGroupMembers } from "~/lib/groups";
import { getPageAccess } from "../pageAccess.server";

const mockPrisma = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(false);
  vi.mocked(partnerHasProjectAccess).mockResolvedValue(false);
  vi.mocked(resolveGroupMembers).mockResolvedValue([]);
  mockPrisma.groupDefinition.findMany.mockResolvedValue([]);
  mockPrisma.pageShare.findMany.mockResolvedValue([]);
  mockPrisma.pageShare.findFirst.mockResolvedValue(null);
  mockPrisma.instructorAssignment.findFirst.mockResolvedValue(null);
});

/** Set the viewer's named-share tier on the page (null = no share). */
function withShare(permission: string | null, principalId = "viewer") {
  mockPrisma.pageShare.findMany.mockResolvedValue(
    permission ? [{ principalType: "User", principalId, permission }] : [],
  );
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-1",
    workspaceType: "Lab",
    workspaceId: null,
    archivedAt: null,
    partnerVisible: false,
    createdById: null,
    profileVisible: false,
    labListing: "None",
    linkAccess: "Restricted",
    linkPermission: "View",
    ...overrides,
  };
}

function denied() {
  return { canView: false, canEdit: false, canComment: false, canResolve: false };
}
const full = { canView: true, canEdit: true, canComment: true, canResolve: true };

// ── Archived pages ──────────────────────────────────────────────────────────
describe("archived pages", () => {
  it("denies all access to archived pages regardless of role", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const result = await getPageAccess("core-user", page({ archivedAt: new Date() }));
    expect(result).toEqual(denied());
  });
});

// ── Member-workspace (personal notes) ───────────────────────────────────────
describe("Member workspace", () => {
  const note = (over: Record<string, unknown> = {}) =>
    page({ workspaceType: "Member", workspaceId: "owner-1", ...over });

  it("denies when workspaceId is null", async () => {
    const result = await getPageAccess("u1", page({ workspaceType: "Member", workspaceId: null }));
    expect(result).toEqual(denied());
  });

  it("grants full access to the owner", async () => {
    const result = await getPageAccess("owner-1", note());
    expect(result).toEqual(full);
  });

  it("grants view+comment to a profile-visible viewer (no edit)", async () => {
    const result = await getPageAccess("viewer", note({ profileVisible: true }));
    expect(result).toEqual({ canView: true, canEdit: false, canComment: true, canResolve: false });
  });

  it("denies a stranger on a private, unshared note", async () => {
    const result = await getPageAccess("stranger", note());
    expect(result).toEqual(denied());
  });

  it("a View share grants view only — not comment", async () => {
    withShare("View");
    const result = await getPageAccess("viewer", note());
    expect(result).toEqual({ canView: true, canEdit: false, canComment: false, canResolve: false });
  });

  it("a Comment share grants view+comment, not edit", async () => {
    withShare("Comment");
    const result = await getPageAccess("viewer", note());
    expect(result).toEqual({ canView: true, canEdit: false, canComment: true, canResolve: false });
  });

  it("an Edit share grants edit", async () => {
    withShare("Edit", "editor");
    const result = await getPageAccess("editor", note());
    expect(result).toEqual(full);
  });

  it("Core gets no bypass on a private note", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const result = await getPageAccess("core-user", note());
    expect(result).toEqual(denied());
  });
});

// ── Lab workspace ────────────────────────────────────────────────────────────
// Lab audience is General access now: "Everyone in the lab" = linkAccess
// LabMembers at the doc's linkPermission tier; "Only people you add" = linkAccess
// Restricted (creator + Core + named shares). No labRestricted boolean.
describe("Lab workspace", () => {
  const everyone = (over: Record<string, unknown> = {}) =>
    page({ linkAccess: "LabMembers", linkPermission: "Edit", ...over });

  it("gives every lab member edit on an 'Everyone in the lab · Edit' doc", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await getPageAccess("lab-member", everyone())).toEqual(full);
  });

  it("'Everyone in the lab · View' grants a lab member view only — not edit", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    const result = await getPageAccess("lab-member", everyone({ linkPermission: "View" }));
    expect(result).toEqual({ canView: true, canEdit: false, canComment: false, canResolve: false });
  });

  it("denies non-members even on a doc open to the lab", async () => {
    expect(await getPageAccess("stranger", everyone())).toEqual(denied());
  });

  it("a View share never downgrades a lab member on an open · Edit doc", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    withShare("View", "lab-member");
    expect(await getPageAccess("lab-member", everyone())).toEqual(full);
  });

  it("the creator keeps full access on an 'Only people you add' doc", async () => {
    const result = await getPageAccess("creator", page({ createdById: "creator" }));
    expect(result).toEqual(full);
  });

  it("Core keeps full access on an 'Only people you add' doc", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const result = await getPageAccess("core-user", page({ createdById: "someone-else" }));
    expect(result).toEqual(full);
  });

  it("an Edit share grants edit to a non-creator on an 'Only people you add' doc", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    withShare("Edit", "outsider");
    const result = await getPageAccess("outsider", page({ createdById: "someone-else" }));
    expect(result.canView).toBe(true);
    expect(result.canEdit).toBe(true);
  });

  it("'Only people you add' denies an unshared non-creator lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    const result = await getPageAccess("outsider", page({ createdById: "someone-else" }));
    expect(result).toEqual(denied());
  });
});

// ── Project workspace ────────────────────────────────────────────────────────
describe("Project workspace", () => {
  const projectPage = (over: Record<string, unknown> = {}) =>
    page({ workspaceType: "Project", workspaceId: "proj-1", ...over });

  it("allows project member full access", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(true);
    const result = await getPageAccess("member", projectPage());
    expect(result).toEqual(full);
    expect(isProjectMember).toHaveBeenCalledWith("member", "proj-1", undefined);
  });

  it("grants view+comment to a non-member lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    const result = await getPageAccess("lab-member", projectPage());
    expect(result).toEqual({ canView: true, canEdit: false, canComment: true, canResolve: false });
  });

  it("denies a stranger", async () => {
    const result = await getPageAccess("stranger", projectPage());
    expect(result).toEqual(denied());
  });

  it("an Edit share grants edit to an outsider (not a member)", async () => {
    withShare("Edit", "outsider");
    const result = await getPageAccess("outsider", projectPage());
    expect(result.canView).toBe(true);
    expect(result.canEdit).toBe(true);
  });

  it("General access LabMembers·Edit grants edit to a lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    const result = await getPageAccess(
      "lab-user",
      projectPage({ linkAccess: "LabMembers", linkPermission: "Edit" }),
    );
    expect(result.canEdit).toBe(true);
  });

  it("General access LabMembers does NOT grant to a non-lab-member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    const result = await getPageAccess(
      "outsider",
      projectPage({ linkAccess: "LabMembers", linkPermission: "Edit" }),
    );
    expect(result).toEqual(denied());
  });

  it("General access Public grants view only", async () => {
    const result = await getPageAccess("any-user", projectPage({ linkAccess: "Public" }));
    expect(result).toEqual({ canView: true, canEdit: false, canComment: false, canResolve: false });
  });

  it("General access never downgrades a project member", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(true);
    const result = await getPageAccess(
      "member",
      projectPage({ linkAccess: "Public" }),
    );
    expect(result).toEqual(full);
  });
});

// ── EducationOffering workspace ──────────────────────────────────────────────
describe("EducationOffering workspace", () => {
  const eduPage = (over: Record<string, unknown> = {}) =>
    page({ workspaceType: "EducationOffering", workspaceId: "offering-1", ...over });

  it("allows instructor full access", async () => {
    mockPrisma.instructorAssignment.findFirst.mockResolvedValue({ id: "ia-1" });
    const result = await getPageAccess("instructor", eduPage());
    expect(result).toEqual(full);
  });

  it("grants view+comment to a non-instructor lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    const result = await getPageAccess("lab-member", eduPage());
    expect(result).toEqual({ canView: true, canEdit: false, canComment: true, canResolve: false });
  });

  it("denies a complete stranger", async () => {
    const result = await getPageAccess("stranger", eduPage());
    expect(result).toEqual(denied());
  });

  it("an Edit share grants edit to an outsider", async () => {
    withShare("Edit", "outsider");
    const result = await getPageAccess("outsider", eduPage());
    expect(result.canEdit).toBe(true);
  });
});

// ── pageId overload (fetches page) ──────────────────────────────────────────
describe("pageId string overload", () => {
  it("returns denied if page not found", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(null);
    const result = await getPageAccess("u1", "missing-page");
    expect(result).toEqual(denied());
    expect(mockPrisma.page.findUnique).toHaveBeenCalledWith({
      where: { id: "missing-page" },
      select: expect.objectContaining({ id: true, workspaceType: true, linkAccess: true }),
    });
  });

  it("fetches the page and computes access", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue(
      page({ workspaceType: "Lab", linkAccess: "LabMembers", linkPermission: "Edit" }),
    );
    const result = await getPageAccess("lab-member", "p1");
    expect(result).toEqual(full);
  });
});

// ── Core drive (Group-scoped folder, cascades to contents) ───────────────────
//
// The Core drive is a Lab folder with scopeKind=Group(core) + linkAccess=
// Restricted. Membership grants Core; Restricted keeps everyone else out. The
// key no-leak property: a lab member who is NOT in the Core group must not see
// the folder OR its Restricted contents, even though they are a lab member.
describe("Core drive (Group scope)", () => {
  const CORE_GROUP = "g-core";
  const coreFolder = (over: Record<string, unknown> = {}) =>
    page({
      id: "core-root",
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: null,
      scopeKind: "Group",
      scopeGroupId: CORE_GROUP,
      scopePermission: "Edit",
      linkAccess: "Restricted",
      linkPermission: "View",
      createdById: "someone-else",
      ...over,
    });

  it("grants a Core-group member full access to the Core folder", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(resolveGroupMembers).mockResolvedValue(["core-user"]);
    const result = await getPageAccess("core-user", coreFolder());
    expect(result).toEqual(full);
    expect(resolveGroupMembers).toHaveBeenCalledWith(CORE_GROUP);
  });

  it("denies a non-Core lab member the Core folder (no lab-wide leak)", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(resolveGroupMembers).mockResolvedValue(["core-user"]);
    const result = await getPageAccess("lab-user", coreFolder());
    expect(result).toEqual(denied());
  });

  it("cascades: a Restricted child under the Core folder is denied to non-Core lab members", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(resolveGroupMembers).mockResolvedValue(["core-user"]);
    // Ancestry walk fetches the governing Core folder by its id.
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "core-root",
      parentPageId: null,
      scopeKind: "Group",
      scopeGroupId: CORE_GROUP,
      scopePermission: "Edit",
      createdById: "someone-else",
    });
    const child = page({
      id: "child-doc",
      workspaceType: "Lab",
      parentPageId: "core-root",
      scopeKind: null,
      linkAccess: "Restricted",
      linkPermission: "View",
      createdById: "someone-else",
    });
    const result = await getPageAccess("lab-user", child);
    expect(result).toEqual(denied());
  });

  it("cascades: a Core-group member reaches the Restricted child via the folder scope", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(resolveGroupMembers).mockResolvedValue(["core-user"]);
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "core-root",
      parentPageId: null,
      scopeKind: "Group",
      scopeGroupId: CORE_GROUP,
      scopePermission: "Edit",
      createdById: "someone-else",
    });
    const child = page({
      id: "child-doc",
      workspaceType: "Lab",
      parentPageId: "core-root",
      scopeKind: null,
      linkAccess: "Restricted",
      linkPermission: "View",
      createdById: "someone-else",
    });
    const result = await getPageAccess("core-user", child);
    expect(result.canView).toBe(true);
    expect(result.canEdit).toBe(true);
  });
});
