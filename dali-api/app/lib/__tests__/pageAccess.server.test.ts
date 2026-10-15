import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
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
  listVisibleGroupIdsForUser: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { resolveGroupMembers, listVisibleGroupIdsForUser } from "~/lib/groups";
import {
  getPageAccess,
  getPageAccessBulk,
  governingScopeMap,
  isUnderGoverningScope,
  PAGE_ACCESS_SELECT,
} from "../pageAccess.server";

const mockPrisma = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(false);
  vi.mocked(partnerHasProjectAccess).mockResolvedValue(false);
  vi.mocked(resolveGroupMembers).mockResolvedValue([]);
  vi.mocked(listVisibleGroupIdsForUser).mockResolvedValue([]);
  mockPrisma.groupDefinition.findMany.mockResolvedValue([]);
  mockPrisma.pageShare.findMany.mockResolvedValue([]);
  mockPrisma.pageShare.findFirst.mockResolvedValue(null);
  mockPrisma.page.findFirst.mockResolvedValue(null);
  mockPrisma.page.findMany.mockResolvedValue([]);
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
  return { canView: false, canEdit: false, canComment: false };
}
const full = { canView: true, canEdit: true, canComment: true };

// ── Archived pages ──────────────────────────────────────────────────────────
describe("archived pages", () => {
  it("denies all access to archived pages regardless of role", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const result = await getPageAccess("core-user", page({ archivedAt: new Date() }));
    expect(result).toEqual(denied());
  });

  // The Drive trash and the meeting-note carve-out act on trashed pages, so a
  // blanket deny leaves the trash unable to list or restore a single document.
  it("applies the page's normal rules when includeArchived is set", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const result = await getPageAccess(
      "core-user",
      page({ archivedAt: new Date() }),
      undefined,
      { includeArchived: true },
    );
    expect(result).toEqual(full);
  });

  it("still denies someone with no claim on the page when includeArchived is set", async () => {
    const result = await getPageAccess(
      "stranger",
      page({ archivedAt: new Date() }),
      undefined,
      { includeArchived: true },
    );
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
    expect(result).toEqual({ canView: true, canEdit: false, canComment: true });
  });

  it("denies a stranger on a private, unshared note", async () => {
    const result = await getPageAccess("stranger", note());
    expect(result).toEqual(denied());
  });

  it("a View share grants view only — not comment", async () => {
    withShare("View");
    const result = await getPageAccess("viewer", note());
    expect(result).toEqual({ canView: true, canEdit: false, canComment: false });
  });

  it("a Comment share grants view+comment, not edit", async () => {
    withShare("Comment");
    const result = await getPageAccess("viewer", note());
    expect(result).toEqual({ canView: true, canEdit: false, canComment: true });
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
    expect(result).toEqual({ canView: true, canEdit: false, canComment: false });
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
    expect(result).toEqual({ canView: true, canEdit: false, canComment: true });
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
    expect(result).toEqual({ canView: true, canEdit: false, canComment: false });
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
    expect(result).toEqual({ canView: true, canEdit: false, canComment: true });
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

describe("PAGE_ACCESS_SELECT", () => {
  it("selects exactly the columns the access computation reads", () => {
    expect(Object.keys(PAGE_ACCESS_SELECT).sort()).toEqual(
      [
        "id",
        "workspaceType",
        "workspaceId",
        "parentPageId",
        "archivedAt",
        "createdById",
        "partnerVisible",
        "profileVisible",
        "labListing",
        "linkAccess",
        "linkPermission",
        "scopeKind",
        "scopeGroupId",
        "scopePermission",
      ].sort(),
    );
  });

  it("selects every column with true", () => {
    expect(Object.values(PAGE_ACCESS_SELECT).every((v) => v === true)).toBe(true);
  });

  it("is what the by-id path selects", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(null);
    await getPageAccess("u1", "page-1");
    expect(mockPrisma.page.findUnique).toHaveBeenCalledWith({
      where: { id: "page-1" },
      select: PAGE_ACCESS_SELECT,
    });
  });
});

// ── Group scope that is not Core, via the object path ───────────────────────
//
// Callers that hand getPageAccess a row instead of an id only get the scope
// cascade if the row carries parentPageId; omitting it silently falls through
// to the Lab creator/Core rule.
describe("Group scope on the object path (non-Core group)", () => {
  const DESIGN_GROUP = "g-design";
  const governingFolder = (permission: "View" | "Edit") => ({
    id: "design-root",
    parentPageId: null,
    scopeKind: "Group",
    scopeGroupId: DESIGN_GROUP,
    scopePermission: permission,
    createdById: "someone-else",
  });
  const childDoc = (over: Record<string, unknown> = {}) =>
    page({
      id: "child-doc",
      workspaceType: "Lab",
      parentPageId: "design-root",
      scopeKind: null,
      linkAccess: "Restricted",
      createdById: "someone-else",
      ...over,
    });

  beforeEach(() => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(resolveGroupMembers).mockResolvedValue(["design-member"]);
  });

  it("lets a group member edit a doc under the folder when scopePermission is Edit", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(governingFolder("Edit"));
    const result = await getPageAccess("design-member", childDoc());
    expect(result).toEqual(full);
    expect(resolveGroupMembers).toHaveBeenCalledWith(DESIGN_GROUP);
  });

  it("lets a group member view but not edit when scopePermission is View", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(governingFolder("View"));
    const result = await getPageAccess("design-member", childDoc());
    expect(result).toEqual({ canView: true, canEdit: false, canComment: false });
  });

  it("denies the same member when the object omits parentPageId", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(governingFolder("Edit"));
    const { parentPageId: _omitted, scopeKind: _scope, ...withoutScopeFields } = childDoc() as Record<string, unknown> & { id: string; workspaceType: string; workspaceId: string | null };
    const result = await getPageAccess("design-member", withoutScopeFields);
    expect(result).toEqual(denied());
    expect(mockPrisma.page.findUnique).not.toHaveBeenCalled();
  });

  it("denies a lab member who is not in the group", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(governingFolder("Edit"));
    const result = await getPageAccess("other-lab-member", childDoc());
    expect(result).toEqual(denied());
  });

  it("still lets the creator in when they are not in the group", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(governingFolder("Edit"));
    const result = await getPageAccess("author", childDoc({ createdById: "author" }));
    expect(result).toEqual(full);
  });

  it("gives Core full access under the folder without group membership", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue(governingFolder("View"));
    const result = await getPageAccess("core-user", childDoc());
    expect(result).toEqual(full);
    expect(resolveGroupMembers).not.toHaveBeenCalled();
  });

  it("gives Core full access under a lab-scoped View folder", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({
      ...governingFolder("View"),
      scopeKind: "Lab",
      scopeGroupId: null,
    });
    const result = await getPageAccess("core-user", childDoc());
    expect(result).toEqual(full);
  });

  it("gives Core no bypass under a Private folder", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({
      ...governingFolder("Edit"),
      scopeKind: "Private",
      scopeGroupId: null,
    });
    const result = await getPageAccess("core-user", childDoc());
    expect(result).toEqual(denied());
  });
});

describe("ignoreShares option", () => {
  const memberNote = (overrides: Record<string, unknown> = {}) =>
    page({ workspaceType: "Member", workspaceId: "someone-else", ...overrides });

  it("denies a note reached only by a named share", async () => {
    withShare("View");
    expect(await getPageAccess("viewer", memberNote())).toEqual({
      canView: true,
      canEdit: false,
      canComment: false,
    });
    expect(await getPageAccess("viewer", memberNote(), undefined, { ignoreShares: true })).toEqual(
      denied(),
    );
  });

  it("does not query shares on the single-page path", async () => {
    await getPageAccess("viewer", memberNote(), undefined, { ignoreShares: true });
    expect(mockPrisma.pageShare.findMany).not.toHaveBeenCalled();
  });

  it("does not query shares on the bulk path", async () => {
    const result = await getPageAccessBulk("viewer", [memberNote()], undefined, {
      ignoreShares: true,
    });
    expect(result.get("page-1")).toEqual(denied());
    expect(mockPrisma.pageShare.findMany).not.toHaveBeenCalled();
  });

  it("keeps access the workspace already gives", async () => {
    withShare("View");
    const result = await getPageAccessBulk(
      "viewer",
      [memberNote({ labListing: "Listed" })],
      undefined,
      { ignoreShares: true },
    );
    expect(result.get("page-1")?.canView).toBe(true);
  });

  it("keeps General access: a public link still grants view", async () => {
    withShare("Edit");
    const result = await getPageAccessBulk(
      "viewer",
      [memberNote({ linkAccess: "Public" })],
      undefined,
      { ignoreShares: true },
    );
    expect(result.get("page-1")).toEqual({ canView: true, canEdit: false, canComment: false });
  });

  it("keeps General access: lab-members link grants a lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    const result = await getPageAccessBulk(
      "viewer",
      [page({ linkAccess: "LabMembers", linkPermission: "Edit" })],
      undefined,
      { ignoreShares: true },
    );
    expect(result.get("page-1")?.canEdit).toBe(true);
  });

  it("keeps Core's full base on a lab page", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const result = await getPageAccessBulk("viewer", [page()], undefined, { ignoreShares: true });
    expect(result.get("page-1")).toEqual(full);
  });
});

describe("governingScopeMap", () => {
  const node = (id: string, parentPageId: string | null, scope: Record<string, unknown> = {}) => ({
    id,
    parentPageId,
    scopeKind: null,
    scopeGroupId: null,
    scopePermission: null,
    createdById: "author",
    ...scope,
  });
  const group = { scopeKind: "Group", scopeGroupId: "g1", scopePermission: "Edit" };
  const priv = { scopeKind: "Private" };

  // root
  // ├─ a (Group g1)
  // │   └─ b ── c
  // ├─ d
  // │   └─ f (Private) ── g
  // └─ (orphan e, parent not in the set)
  const tree = [
    node("root", null),
    node("a", "root", group),
    node("b", "a"),
    node("c", "b"),
    node("d", "root"),
    node("f", "d", priv),
    node("g", "f"),
    node("e", "missing-parent"),
  ];
  const expected: Record<string, string | null> = {
    root: null,
    a: "a",
    b: "a",
    c: "a",
    d: null,
    f: "f",
    g: "f",
    e: null,
  };

  it("resolves the nearest scoped ancestor, the page itself when scoped, else null", () => {
    const map = governingScopeMap(tree);
    for (const [id, governingId] of Object.entries(expected)) {
      expect(map.get(id)?.id ?? null, id).toBe(governingId);
    }
    expect(map.size).toBe(tree.length);
  });

  it("nearest scope shadows a further ancestor", () => {
    const rows = [node("top", null, group), node("mid", "top", priv), node("leaf", "mid")];
    expect(governingScopeMap(rows).get("leaf")?.id).toBe("mid");
  });

  it("returns null when a parent is missing from the rows", () => {
    expect(governingScopeMap([node("lonely", "gone")]).get("lonely")).toBeNull();
  });

  it("stops after eight ancestors, like the DB walk", () => {
    const chain = [node("n0", null, group)];
    for (let i = 1; i <= 10; i++) chain.push(node(`n${i}`, `n${i - 1}`));
    const map = governingScopeMap(chain);
    expect(map.get("n8")?.id).toBe("n0");
    expect(map.get("n9")).toBeNull();
    expect(map.get("n10")).toBeNull();
  });

  describe("agrees with the DB walk", () => {
    const byId = new Map(tree.map((r) => [r.id, r]));
    beforeEach(() => {
      mockPrisma.page.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
        byId.get(where.id) ?? null,
      );
    });

    it("on the governing folder of every page's parent chain", async () => {
      const map = governingScopeMap(tree);
      for (const row of tree) {
        const viaDb = await isUnderGoverningScope(row.parentPageId);
        const parentGoverned = row.parentPageId !== null && (map.get(row.parentPageId) ?? null) !== null;
        expect(parentGoverned, row.id).toBe(viaDb);
      }
    });

    it("on the access getPageAccessBulk computes for every viewer", async () => {
      const pages = tree.map((r) => ({
        ...page({ id: r.id, createdById: r.createdById }),
        ...r,
      }));
      vi.mocked(isLabMember).mockResolvedValue(true);
      vi.mocked(resolveGroupMembers).mockImplementation(async (id: string) =>
        id === "g1" ? ["member"] : [],
      );
      for (const viewer of ["member", "author", "stranger"]) {
        mockPrisma.page.findUnique.mockClear();
        const viaDb = await getPageAccessBulk(viewer, pages);
        const dbWalks = mockPrisma.page.findUnique.mock.calls.length;
        mockPrisma.page.findUnique.mockClear();
        const viaMap = await getPageAccessBulk(viewer, pages, undefined, undefined, governingScopeMap(tree));
        expect(viaMap, viewer).toEqual(viaDb);
        expect(dbWalks).toBeGreaterThan(0);
        expect(mockPrisma.page.findUnique).not.toHaveBeenCalled();
      }
    });
  });

  it("falls back to the DB walk for a page missing from the map", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "folder",
      parentPageId: null,
      scopeKind: "Private",
      scopeGroupId: null,
      scopePermission: null,
      createdById: "someone-else",
    });
    vi.mocked(isLabMember).mockResolvedValue(true);
    const child = { ...page({ id: "child", createdById: "x" }), parentPageId: "folder", scopeKind: null };
    const res = await getPageAccessBulk("viewer", [child], undefined, undefined, new Map());
    expect(res.get("child")).toEqual(denied());
    expect(mockPrisma.page.findUnique).toHaveBeenCalled();
  });
});

describe("notebook shares reach tabs", () => {
  type Row = { pageId: string; principalType: string; principalId: string; permission: string };
  const tab = (overrides: Record<string, unknown> = {}) => page({ id: "tab1", parentPageId: "nb1", ...overrides });

  function shareRows(rows: Row[]) {
    mockPrisma.pageShare.findMany.mockImplementation(async ({ where }: any) =>
      rows.filter((r) => where.pageId.in.includes(r.pageId)),
    );
  }
  const nbShare = (permission: string, principalType = "User", principalId = "viewer"): Row => ({
    pageId: "nb1",
    principalType,
    principalId,
    permission,
  });

  it.each([
    ["View", { canView: true, canEdit: false, canComment: false }],
    ["Comment", { canView: true, canEdit: false, canComment: true }],
    ["Edit", full],
  ])("a %s share on the notebook gives the same tier on the tab", async (permission, expected) => {
    mockPrisma.page.findFirst.mockResolvedValue({ id: "nb1" });
    shareRows([nbShare(permission)]);
    expect(await getPageAccess("viewer", tab())).toEqual(expected);
    expect(mockPrisma.page.findFirst).toHaveBeenCalledWith({
      where: { id: "nb1", kind: "Notebook" },
      select: { id: true },
    });
    expect(mockPrisma.pageShare.findMany.mock.calls[0][0].where.pageId).toEqual({ in: ["tab1", "nb1"] });
  });

  it("a Group share on the notebook reaches the tab for a group member", async () => {
    vi.mocked(listVisibleGroupIdsForUser).mockResolvedValue([{ id: "g1", archivedAt: null }] as any);
    mockPrisma.page.findFirst.mockResolvedValue({ id: "nb1" });
    shareRows([nbShare("Edit", "Group", "g1")]);
    expect(await getPageAccess("viewer", tab())).toEqual(full);
  });

  it("a Group share does not reach a non-member", async () => {
    mockPrisma.page.findFirst.mockResolvedValue({ id: "nb1" });
    shareRows([nbShare("Edit", "Group", "g1")]);
    expect(await getPageAccess("viewer", tab())).toEqual(denied());
  });

  it("does not inherit when the parent is not a notebook", async () => {
    mockPrisma.page.findFirst.mockResolvedValue(null);
    shareRows([nbShare("Edit")]);
    expect(await getPageAccess("viewer", tab())).toEqual(denied());
    expect(mockPrisma.pageShare.findMany.mock.calls[0][0].where.pageId).toEqual({ in: ["tab1"] });
  });

  it("a page without a parent makes no notebook lookup", async () => {
    shareRows([]);
    await getPageAccess("viewer", page());
    expect(mockPrisma.page.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.pageShare.findMany.mock.calls[0][0].where.pageId).toEqual({ in: ["page-1"] });
  });

  it("the tab's own share and the notebook's share combine to the higher tier", async () => {
    mockPrisma.page.findFirst.mockResolvedValue({ id: "nb1" });
    shareRows([nbShare("Edit"), { ...nbShare("View"), pageId: "tab1" }]);
    expect(await getPageAccess("viewer", tab())).toEqual(full);
    shareRows([nbShare("View"), { ...nbShare("Comment"), pageId: "tab1" }]);
    expect(await getPageAccess("viewer", tab())).toEqual({ canView: true, canEdit: false, canComment: true });
  });

  it("ignoreShares skips both lookups", async () => {
    mockPrisma.page.findFirst.mockResolvedValue({ id: "nb1" });
    shareRows([nbShare("Edit")]);
    expect(await getPageAccess("viewer", tab(), undefined, { ignoreShares: true })).toEqual(denied());
    expect(mockPrisma.page.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.pageShare.findMany).not.toHaveBeenCalled();
  });

  it("bulk: only the notebook's tab inherits, with one shares query and one parent-kind query", async () => {
    mockPrisma.page.findMany.mockResolvedValue([{ id: "nb1" }]);
    mockPrisma.page.findFirst.mockResolvedValue({ id: "nb1" });
    shareRows([nbShare("Edit")]);
    const pages = [
      page({ id: "nb1", parentPageId: null }),
      tab(),
      page({ id: "plain", parentPageId: null }),
    ];
    const bulk = await getPageAccessBulk("viewer", pages);
    expect(bulk.get("tab1")).toEqual(full);
    expect(bulk.get("plain")).toEqual(denied());
    expect(mockPrisma.pageShare.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.pageShare.findMany.mock.calls[0][0].where.pageId.in).toContain("nb1");
    expect(mockPrisma.page.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["nb1"] }, kind: "Notebook" },
      select: { id: true },
    });
    for (const p of pages) {
      expect(bulk.get(p.id)).toEqual(await getPageAccess("viewer", p));
    }
  });

  it("bulk: no parent lookup when no page has a parent", async () => {
    await getPageAccessBulk("viewer", [page()]);
    expect(mockPrisma.page.findMany).not.toHaveBeenCalled();
  });
});
