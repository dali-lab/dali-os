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

import { prisma } from "~/lib/db";
import { collectSubtree } from "~/lib/pages";
import { setFolderScope } from "~/lib/page-share-access.server";

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
