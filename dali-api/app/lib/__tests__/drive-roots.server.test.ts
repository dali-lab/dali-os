import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    page: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    pageShare: { upsert: vi.fn() },
    groupDefinition: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/groups", () => ({ ensureMentorsGroup: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db.server";
import { ensureMentorsGroup } from "~/lib/groups";
import { ROOTS, findRoot, ensureRoot, ensureAllRoots, isRoot } from "~/lib/drive-roots.server";

const m = prisma as any;

const GROUPS: Record<string, { id: string } | null> = {
  core: { id: "grp_core" },
  mentors: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  m.groupDefinition.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(GROUPS[where.systemKey] ?? null),
  );
  m.page.findFirst.mockResolvedValue(null);
  m.page.create.mockResolvedValue({ id: "new_root" });
  m.page.update.mockResolvedValue({});
  m.pageShare.upsert.mockResolvedValue({});
  GROUPS.mentors = null;
});

describe("ROOTS registry", () => {
  it("declares the three process roots", () => {
    expect(ROOTS.core).toMatchObject({ processType: "Core", processId: "core", title: "Core", scopePermission: "Edit" });
    expect(ROOTS.hiring).toMatchObject({ processType: "HiringCycle", processId: "hiring", title: "Hiring", scopeGroupKey: "core" });
    expect(ROOTS.mentorship).toMatchObject({
      processType: "Mentorship",
      processId: "mentorship",
      scopeGroupKey: "mentors",
      scopePermission: "View",
    });
  });
});

describe("isRoot", () => {
  it("is true only for folderType Root", () => {
    expect(isRoot({ folderType: "Root" })).toBe(true);
    expect(isRoot({ folderType: "Meetings" })).toBe(false);
    expect(isRoot({ folderType: null })).toBe(false);
    expect(isRoot({})).toBe(false);
  });
});

describe("findRoot", () => {
  it("looks up the live page by process type, process id and Root type", async () => {
    m.page.findFirst.mockResolvedValue({ id: "r1" });
    expect(await findRoot("hiring")).toBe("r1");
    expect(m.page.findFirst).toHaveBeenCalledWith({
      where: { processType: "HiringCycle", processId: "hiring", folderType: "Root", archivedAt: null },
      select: { id: true },
    });
  });

  it("returns null when there is none", async () => {
    expect(await findRoot("core")).toBeNull();
  });
});

describe("ensureRoot", () => {
  it("returns an existing root without touching anything", async () => {
    m.page.findFirst.mockResolvedValue({ id: "existing" });
    expect(await ensureRoot("core", "u1")).toBe("existing");
    expect(m.page.create).not.toHaveBeenCalled();
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("adopts the legacy Core shell by title and core scope, keeping its id", async () => {
    m.page.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "legacy_core" });

    expect(await ensureRoot("core", "u1")).toBe("legacy_core");

    expect(m.page.findFirst.mock.calls[1][0].where).toMatchObject({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: null,
      kind: "Folder",
      archivedAt: null,
      folderType: null,
      scopeKind: "Group",
      scopeGroupId: "grp_core",
      title: { equals: "Core", mode: "insensitive" },
    });
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "legacy_core" },
      data: {
        folderType: "Root",
        processType: "Core",
        processId: "core",
        linkAccess: "Restricted",
        linkPermission: "View",
      },
    });
    expect(m.page.create).not.toHaveBeenCalled();
  });

  it("adopts a legacy Hiring shell the same way", async () => {
    m.page.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "legacy_hiring" });
    expect(await ensureRoot("hiring", "u1")).toBe("legacy_hiring");
    expect(m.page.findFirst.mock.calls[1][0].where.title).toEqual({ equals: "Hiring", mode: "insensitive" });
    expect(m.page.update.mock.calls[0][0].data).toMatchObject({ processType: "HiringCycle", processId: "hiring" });
  });

  it("creates a Lab top-level group-scoped folder when there is nothing to adopt", async () => {
    m.page.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ position: 4 });

    expect(await ensureRoot("core", "u1")).toBe("new_root");

    expect(m.page.create).toHaveBeenCalledWith({
      data: {
        workspaceType: "Lab",
        workspaceId: null,
        parentPageId: null,
        title: "Core",
        kind: "Folder",
        position: 5,
        createdById: "u1",
        scopeKind: "Group",
        scopeGroupId: "grp_core",
        scopePermission: "Edit",
        linkAccess: "Restricted",
        linkPermission: "View",
        folderType: "Root",
        processType: "Core",
        processId: "core",
      },
      select: { id: true },
    });
    expect(m.pageShare.upsert).not.toHaveBeenCalled();
  });

  it("re-finds the winner when a concurrent create hits the unique index", async () => {
    m.page.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "winner" });
    m.page.create.mockRejectedValue({ code: "P2002" });

    expect(await ensureRoot("core", "u1")).toBe("winner");
  });

  it("rethrows other create failures", async () => {
    m.page.create.mockRejectedValue(new Error("boom"));
    await expect(ensureRoot("core", "u1")).rejects.toThrow("boom");
  });

  it("throws when the Core group does not exist", async () => {
    GROUPS.core = null;
    await expect(ensureRoot("core", "u1")).rejects.toThrow(/Core group/);
    GROUPS.core = { id: "grp_core" };
  });

  it("does not look for a legacy shell for Mentorship", async () => {
    GROUPS.mentors = { id: "grp_mentors" };
    await ensureRoot("mentorship", "u1");
    expect(m.page.update).not.toHaveBeenCalled();
    expect(m.page.findFirst).toHaveBeenCalledTimes(2);
  });

  it("refuses to create the Mentorship root without a mentors group", async () => {
    await expect(ensureRoot("mentorship", "u1")).rejects.toThrow(/mentors group/);
    expect(ensureMentorsGroup).toHaveBeenCalled();
    expect(m.page.create).not.toHaveBeenCalled();
  });

  it("ensures the mentors group, scopes Mentorship to it at View, and shares it with Core at Edit", async () => {
    GROUPS.mentors = { id: "grp_mentors" };

    expect(await ensureRoot("mentorship", "u1")).toBe("new_root");

    expect(ensureMentorsGroup).toHaveBeenCalled();
    expect(m.page.create.mock.calls[0][0].data).toMatchObject({
      title: "Mentorship",
      scopeKind: "Group",
      scopeGroupId: "grp_mentors",
      scopePermission: "View",
      folderType: "Root",
      processType: "Mentorship",
      processId: "mentorship",
    });
    expect(m.pageShare.upsert).toHaveBeenCalledWith({
      where: {
        pageId_principalType_principalId: { pageId: "new_root", principalType: "Group", principalId: "grp_core" },
      },
      update: { permission: "Edit" },
      create: {
        pageId: "new_root",
        principalType: "Group",
        principalId: "grp_core",
        permission: "Edit",
        createdById: "u1",
      },
    });
  });
});

describe("ensureAllRoots", () => {
  it("returns an id for every root", async () => {
    m.page.findFirst
      .mockResolvedValueOnce({ id: "c" })
      .mockResolvedValueOnce({ id: "h" })
      .mockResolvedValueOnce({ id: "m" });
    expect(await ensureAllRoots("u1")).toEqual({ core: "c", hiring: "h", mentorship: "m" });
  });
});
