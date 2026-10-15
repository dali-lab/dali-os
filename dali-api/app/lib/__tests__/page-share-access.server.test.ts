import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    groupDefinition: { findUnique: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/page-sharing.server", () => ({ sharePermissionFor: vi.fn() }));
vi.mock("~/lib/pages", () => ({ collectSubtree: vi.fn() }));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn() }));

import { prisma } from "~/lib/db";
import { collectSubtree } from "~/lib/pages";
import { resolveGroupMembers } from "~/lib/groups";
import { setFolderScope, setGeneralAccess } from "~/lib/page-share-access.server";

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
