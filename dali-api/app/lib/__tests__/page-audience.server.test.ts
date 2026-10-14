import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    pageShare: { findMany: vi.fn() },
    meetingShareGrant: { findMany: vi.fn() },
    groupDefinition: { findMany: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    page: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isProjectMember: vi.fn(),
  isLabMember: vi.fn(),
}));
vi.mock("~/partners/lib/partner-access", () => ({ partnerHasProjectAccess: vi.fn() }));
vi.mock("~/lib/groups", () => ({
  resolveGroupMembers: vi.fn(),
  listVisibleGroupIdsForUser: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { resolveGroupMembers } from "~/lib/groups";
import { describePageAudience, summarizeAudience, type AudiencePageRow } from "../page-audience.server";

const db = prisma as any;
const VIEWER = "viewer";

function row(over: Partial<AudiencePageRow> & { id: string }): AudiencePageRow {
  return {
    title: over.id,
    parentPageId: null,
    workspaceType: "Lab",
    createdById: "someone",
    linkAccess: "Restricted",
    linkPermission: "View",
    scopeKind: null,
    scopeGroupId: null,
    scopePermission: null,
    ...over,
  };
}

function share(pageId: string, principalType: "User" | "Group", principalId: string, permission = "View") {
  return { pageId, principalType, principalId, permission };
}

async function one(r: AudiencePageRow, extra: AudiencePageRow[] = [], canManage = false) {
  const map = await summarizeAudience(VIEWER, [r, ...extra], { canManageSharing: () => canManage });
  return map.get(r.id)!;
}

beforeEach(() => {
  vi.resetAllMocks();
  db.pageShare.findMany.mockResolvedValue([]);
  db.groupDefinition.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
  db.meetingShareGrant.findMany.mockResolvedValue([]);
});

describe("summarizeAudience: link access", () => {
  it("Public link wins over everything and is view-only", async () => {
    const a = await one(row({ id: "p", linkAccess: "Public", scopeKind: "Private" }));
    expect(a).toEqual({ kind: "public", label: "Anyone with the link", permission: "View" });
  });

  it("LabMembers link is lab-wide at the link tier", async () => {
    const a = await one(row({ id: "p", linkAccess: "LabMembers", linkPermission: "Comment" }));
    expect(a).toMatchObject({ kind: "lab", label: "Everyone in the lab", permission: "Comment" });
    expect(a.inheritedFrom).toBeUndefined();
  });

  it("a link never reports FullAccess", async () => {
    const a = await one(row({ id: "p", linkAccess: "LabMembers", linkPermission: "FullAccess" }));
    expect(a.permission).toBe("Edit");
  });
});

describe("summarizeAudience: governing scope", () => {
  const folder = (over: Partial<AudiencePageRow> = {}) =>
    row({ id: "folder", title: "Hiring", scopeKind: "Group", scopeGroupId: "g-core", scopePermission: "Edit", ...over });

  it("Group scope names the group and marks the folder it came from", async () => {
    db.groupDefinition.findMany.mockResolvedValue([{ id: "g-core", name: "Core" }]);
    const child = row({ id: "child", parentPageId: "folder" });
    const a = await one(child, [folder()]);
    expect(a).toEqual({
      kind: "group",
      label: "Core",
      permission: "Edit",
      inheritedFrom: { id: "folder", title: "Hiring" },
    });
  });

  it("the scoped folder itself is not 'inherited'", async () => {
    db.groupDefinition.findMany.mockResolvedValue([{ id: "g-core", name: "Core" }]);
    const map = await summarizeAudience(VIEWER, [folder()], { canManageSharing: () => false });
    expect(map.get("folder")).toEqual({ kind: "group", label: "Core", permission: "Edit" });
  });

  it("looks the group names up once for all pages", async () => {
    db.groupDefinition.findMany.mockResolvedValue([{ id: "g-core", name: "Core" }]);
    await summarizeAudience(
      VIEWER,
      [folder(), row({ id: "a", parentPageId: "folder" }), row({ id: "b", parentPageId: "folder" })],
      { canManageSharing: () => false },
    );
    expect(db.groupDefinition.findMany).toHaveBeenCalledTimes(1);
    expect(db.groupDefinition.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["g-core"] } },
      select: { id: true, name: true },
    });
  });

  it("does not query groups when nothing is group-scoped", async () => {
    await one(row({ id: "p" }));
    expect(db.groupDefinition.findMany).not.toHaveBeenCalled();
  });

  it("falls back to a generic label for a deleted group", async () => {
    const a = await one(row({ id: "p", scopeKind: "Group", scopeGroupId: "gone" }));
    expect(a.label).toBe("A group");
  });

  it("Group scope clamps FullAccess and defaults the tier to Edit", async () => {
    expect((await one(row({ id: "p", scopeKind: "Group", scopeGroupId: "g", scopePermission: "FullAccess" }))).permission).toBe("Edit");
    expect((await one(row({ id: "p", scopeKind: "Group", scopeGroupId: "g", scopePermission: "View" }))).permission).toBe("View");
    expect((await one(row({ id: "p", scopeKind: "Group", scopeGroupId: "g" }))).permission).toBe("Edit");
  });

  it("Lab scope is lab-wide and defaults to View", async () => {
    const a = await one(row({ id: "p", scopeKind: "Lab" }));
    expect(a).toEqual({ kind: "lab", label: "Everyone in the lab", permission: "View" });
  });

  it("Lab scope is inherited by children", async () => {
    const a = await one(row({ id: "c", parentPageId: "f" }), [row({ id: "f", title: "Shared", scopeKind: "Lab" })]);
    expect(a.inheritedFrom).toEqual({ id: "f", title: "Shared" });
  });

  it("Private scope says 'Only you' to the creator", async () => {
    const a = await one(row({ id: "p", scopeKind: "Private", createdById: VIEWER }));
    expect(a).toEqual({ kind: "private", label: "Only you", permission: "Edit" });
  });

  it("Private scope says 'Owner only' to anyone else", async () => {
    const a = await one(row({ id: "p", scopeKind: "Private", createdById: "other" }));
    expect(a).toMatchObject({ kind: "private", label: "Owner only" });
  });

  it("the nearest scope wins over a further ancestor", async () => {
    const top = row({ id: "top", scopeKind: "Lab" });
    const mid = row({ id: "mid", parentPageId: "top", title: "Mid", scopeKind: "Private" });
    const a = await one(row({ id: "leaf", parentPageId: "mid" }), [top, mid]);
    expect(a).toMatchObject({ kind: "private", inheritedFrom: { id: "mid", title: "Mid" } });
  });

  it("uses a caller-supplied governing map instead of walking the rows", async () => {
    const governing = {
      id: "elsewhere",
      title: "Elsewhere",
      parentPageId: null,
      scopeKind: "Lab" as const,
      scopeGroupId: null,
      scopePermission: null,
      createdById: null,
    };
    const map = await summarizeAudience(VIEWER, [row({ id: "p" })], {
      canManageSharing: () => false,
      governingByPageId: new Map([["p", governing]]),
    });
    expect(map.get("p")).toMatchObject({ kind: "lab", inheritedFrom: { id: "elsewhere", title: "Elsewhere" } });
  });
});

describe("summarizeAudience: no scope", () => {
  it("Project pages are the project team, and say the lab can view", async () => {
    const a = await one(row({ id: "p", workspaceType: "Project" }));
    expect(a).toEqual({ kind: "project", label: "Project team · lab can view", permission: "Edit" });
  });

  it("Education pages are instructors, and say the lab can view", async () => {
    const a = await one(row({ id: "p", workspaceType: "EducationOffering" }));
    expect(a).toEqual({ kind: "project", label: "Instructors · lab can view", permission: "Edit" });
  });

  it("Member pages are private", async () => {
    const a = await one(row({ id: "p", workspaceType: "Member", createdById: VIEWER }));
    expect(a).toEqual({ kind: "private", label: "Only you", permission: "Edit" });
  });

  it("an unshared restricted Lab page is private", async () => {
    expect(await one(row({ id: "p", createdById: VIEWER }))).toEqual({
      kind: "private",
      label: "Only you",
      permission: "Edit",
    });
    expect(await one(row({ id: "p", createdById: "x" }))).toMatchObject({ kind: "private", label: "Owner only" });
  });

  it("a shared restricted Lab page is 'people', with the highest share tier", async () => {
    db.pageShare.findMany.mockResolvedValue([
      share("p", "User", "u1", "View"),
      share("p", "Group", "g1", "Comment"),
    ]);
    const a = await one(row({ id: "p" }));
    expect(a).toEqual({
      kind: "people",
      label: "Shared with 2 people and groups",
      count: 2,
      permission: "Comment",
    });
  });

  it("a single share reads in the singular", async () => {
    db.pageShare.findMany.mockResolvedValue([share("p", "User", "u1", "FullAccess")]);
    const a = await one(row({ id: "p" }));
    expect(a).toMatchObject({ label: "Shared with 1 person or group", permission: "Edit" });
  });

  it("shares on a project page add a count but keep the project kind", async () => {
    db.pageShare.findMany.mockResolvedValue([share("p", "User", "u1")]);
    expect(await one(row({ id: "p", workspaceType: "Project" }))).toMatchObject({ kind: "project", count: 1 });
  });

  it("shares on a group-scoped page add a count", async () => {
    db.pageShare.findMany.mockResolvedValue([share("p", "User", "u1"), share("p", "Group", "g2")]);
    db.groupDefinition.findMany.mockResolvedValue([{ id: "g", name: "Core" }]);
    const a = await one(row({ id: "p", scopeKind: "Group", scopeGroupId: "g" }));
    expect(a).toMatchObject({ kind: "group", label: "Core", count: 2 });
  });

  it("omits count when there are no shares", async () => {
    expect((await one(row({ id: "p" }))).count).toBeUndefined();
  });
});

describe("summarizeAudience: queries", () => {
  it("does nothing for an empty list", async () => {
    const map = await summarizeAudience(VIEWER, [], { canManageSharing: () => true });
    expect(map.size).toBe(0);
    expect(db.pageShare.findMany).not.toHaveBeenCalled();
  });

  it("reads every page's shares in one query", async () => {
    await summarizeAudience(VIEWER, [row({ id: "a" }), row({ id: "b" })], { canManageSharing: () => false });
    expect(db.pageShare.findMany).toHaveBeenCalledTimes(1);
    expect(db.pageShare.findMany.mock.calls[0][0].where).toEqual({ pageId: { in: ["a", "b"] } });
  });
});

describe("summarizeAudience: people (viewer-safe)", () => {
  const users = [
    { id: "u1", firstName: "Ada", lastName: "Lovelace", photoUrl: "https://x/ada.png" },
    { id: "u2", firstName: "Grace", lastName: "Hopper", photoUrl: null },
    { id: "u3", firstName: "Alan", lastName: "Turing", photoUrl: null },
    { id: "u4", firstName: "Edsger", lastName: "Dijkstra", photoUrl: null },
  ];
  beforeEach(() => {
    db.pageShare.findMany.mockResolvedValue([
      share("p", "User", "u1"),
      share("p", "Group", "g1"),
      share("p", "User", "u2"),
      share("p", "User", "u3"),
      share("p", "User", "u4"),
    ]);
    db.user.findMany.mockResolvedValue(users);
  });

  it("never resolves names for a viewer who cannot manage sharing", async () => {
    const a = await one(row({ id: "p" }), [], false);
    expect(a.people).toBeUndefined();
    expect(a.count).toBe(5);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("gives managers the first three user principals with photos, and the full count", async () => {
    const a = await one(row({ id: "p" }), [], true);
    expect(a.people).toEqual([
      { id: "u1", name: "Ada Lovelace", photoUrl: "https://x/ada.png" },
      { id: "u2", name: "Grace Hopper", photoUrl: null },
      { id: "u3", name: "Alan Turing", photoUrl: null },
    ]);
    expect(a.count).toBe(5);
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    expect(db.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["u1", "u2", "u3"] } });
  });

  it("flags canManage only on pages the viewer manages", async () => {
    const map = await summarizeAudience(
      VIEWER,
      [row({ id: "mine" }), row({ id: "theirs" })],
      { canManageSharing: (id) => id === "mine" },
    );
    expect(map.get("mine")!.canManage).toBe(true);
    expect(map.get("theirs")!.canManage).toBeUndefined();
  });

  it("asks per page, so a manager of one page does not unmask another", async () => {
    db.pageShare.findMany.mockResolvedValue([share("mine", "User", "u1"), share("theirs", "User", "u2")]);
    const map = await summarizeAudience(
      VIEWER,
      [row({ id: "mine" }), row({ id: "theirs" })],
      { canManageSharing: (id) => id === "mine" },
    );
    expect(map.get("mine")!.people?.map((p) => p.id)).toEqual(["u1"]);
    expect(map.get("theirs")!.people).toBeUndefined();
    expect(db.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["u1"] } });
  });

  it("omits people when the page has only group shares", async () => {
    db.pageShare.findMany.mockResolvedValue([share("p", "Group", "g1")]);
    const a = await one(row({ id: "p" }), [], true);
    expect(a.people).toBeUndefined();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("does not replace the globe on a public or lab-wide page", async () => {
    const pub = await one(row({ id: "p", linkAccess: "Public" }), [], true);
    expect(pub.people).toBeUndefined();
    const lab = await one(row({ id: "p", linkAccess: "LabMembers" }), [], true);
    expect(lab.people).toBeUndefined();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("falls back to a placeholder name for a deleted user's blank name", async () => {
    db.pageShare.findMany.mockResolvedValue([share("p", "User", "u1")]);
    db.user.findMany.mockResolvedValue([{ id: "u1", firstName: "", lastName: "", photoUrl: null }]);
    const a = await one(row({ id: "p" }), [], true);
    expect(a.people).toEqual([{ id: "u1", name: "Unknown member", photoUrl: null }]);
  });

  it("drops a principal whose user row no longer exists", async () => {
    db.user.findMany.mockResolvedValue([users[1]]);
    const a = await one(row({ id: "p" }), [], true);
    expect(a.people?.map((p) => p.id)).toEqual(["u2"]);
  });
});

describe("describePageAudience", () => {
  const tree: Record<string, any> = {
    folder: row({ id: "folder", title: "Hiring", scopeKind: "Group", scopeGroupId: "g-core", scopePermission: "View" }),
    child: row({ id: "child", parentPageId: "folder", createdById: VIEWER }),
    deep: row({ id: "deep", parentPageId: "child" }),
    open: row({ id: "open", workspaceType: "Project" }),
    labFolder: row({ id: "labFolder", title: "Shared", scopeKind: "Lab" }),
    labChild: row({ id: "labChild", parentPageId: "labFolder" }),
  };
  beforeEach(() => {
    db.page.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => tree[where.id] ?? null);
    db.groupDefinition.findMany.mockResolvedValue([{ id: "g-core", name: "Core" }]);
    db.groupDefinition.findUnique.mockResolvedValue({ name: "Core" });
  });

  it("reports the inherited group scope and the audience it implies", async () => {
    const { audience, inherited } = await describePageAudience(VIEWER, "deep");
    expect(inherited).toEqual({
      folderId: "folder",
      title: "Hiring",
      scopeKind: "Group",
      groupName: "Core",
      permission: "View",
    });
    expect(audience).toMatchObject({
      kind: "group",
      label: "Core",
      permission: "View",
      inheritedFrom: { id: "folder", title: "Hiring" },
    });
  });

  it("inherits a Lab scope without looking up a group", async () => {
    const { inherited } = await describePageAudience(VIEWER, "labChild");
    expect(inherited).toEqual({
      folderId: "labFolder",
      title: "Shared",
      scopeKind: "Lab",
      groupName: null,
      permission: "View",
    });
    expect(db.groupDefinition.findUnique).not.toHaveBeenCalled();
  });

  it("a scoped folder itself inherits nothing", async () => {
    const { audience, inherited } = await describePageAudience(VIEWER, "folder");
    expect(inherited).toBeNull();
    expect(audience).toMatchObject({ kind: "group", label: "Core" });
    expect(audience?.inheritedFrom).toBeUndefined();
  });

  it("an unscoped page inherits nothing and falls back to the workspace default", async () => {
    const { audience, inherited } = await describePageAudience(VIEWER, "open");
    expect(inherited).toBeNull();
    expect(audience).toMatchObject({ kind: "project", label: "Project team · lab can view" });
  });

  it("never resolves people, even when the shares exist", async () => {
    db.pageShare.findMany.mockResolvedValue([share("open", "User", "u1")]);
    const { audience } = await describePageAudience(VIEWER, "open");
    expect(audience?.people).toBeUndefined();
    expect(audience?.canManage).toBeUndefined();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("returns nothing for a missing page", async () => {
    expect(await describePageAudience(VIEWER, "gone")).toEqual({ audience: null, inherited: null });
  });
});

describe("summarizeAudience: meeting editors", () => {
  const grant = (pageId: string, principalType: "User" | "Group", principalId: string) => ({ pageId, principalType, principalId });

  it("counts distinct people plus the members of granted groups, per page", async () => {
    db.meetingShareGrant.findMany.mockResolvedValue([
      grant("nb", "User", "u1"),
      grant("nb", "User", "u1"),
      grant("nb", "User", "u2"),
      grant("nb", "Group", "g1"),
      grant("nb", "Group", "g1"),
      grant("other", "User", "u1"),
    ]);
    vi.mocked(resolveGroupMembers).mockResolvedValue(["a", "b", "c"]);

    const map = await summarizeAudience(VIEWER, [row({ id: "nb" }), row({ id: "other" }), row({ id: "none" })], {
      canManageSharing: () => false,
    });

    expect(map.get("nb")?.meetingEditors).toBe(5);
    expect(map.get("other")?.meetingEditors).toBe(1);
    expect(map.get("none")?.meetingEditors).toBeUndefined();
    expect(resolveGroupMembers).toHaveBeenCalledTimes(1);
  });

  it("leaves the field off when a group grant resolves to nobody", async () => {
    db.meetingShareGrant.findMany.mockResolvedValue([grant("nb", "Group", "g1")]);
    vi.mocked(resolveGroupMembers).mockResolvedValue([]);

    expect((await one(row({ id: "nb" }))).meetingEditors).toBeUndefined();
  });
});
