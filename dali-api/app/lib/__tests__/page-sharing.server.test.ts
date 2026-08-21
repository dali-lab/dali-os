import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    groupDefinition: { findMany: vi.fn(), findUnique: vi.fn() },
    pageShare: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/groups", () => ({
  listVisibleGroupsForUser: vi.fn().mockResolvedValue([]),
  resolveGroupMembers: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "~/lib/db";
import { listVisibleGroupsForUser } from "~/lib/groups";
import {
  permissionAtLeast,
  sharePermissionFor,
  groupIdsForUser,
  addPageShare,
  SharePrincipalError,
} from "../page-sharing.server";

const m = prisma as any;

// Shaped as listVisibleGroupsForUser returns — groupIdsForUser reads only id + archivedAt.
const memberGroup = (id: string, archivedAt: string | null = null) => ({ id, archivedAt }) as any;

beforeEach(() => {
  vi.resetAllMocks();
  m.pageShare.findMany.mockResolvedValue([]);
  vi.mocked(listVisibleGroupsForUser).mockResolvedValue([]);
});

describe("permissionAtLeast", () => {
  it("orders View < Comment < Edit < FullAccess", () => {
    expect(permissionAtLeast("Edit", "Comment")).toBe(true);
    expect(permissionAtLeast("FullAccess", "Edit")).toBe(true);
    expect(permissionAtLeast("View", "Comment")).toBe(false);
    expect(permissionAtLeast("Comment", "Comment")).toBe(true);
  });
});

describe("sharePermissionFor", () => {
  it("returns null when there are no matching shares", async () => {
    m.pageShare.findMany.mockResolvedValue([]);
    expect(await sharePermissionFor("p1", "u1")).toBeNull();
  });

  it("returns the highest tier among direct and group shares", async () => {
    m.pageShare.findMany.mockResolvedValue([
      { permission: "View" },
      { permission: "Edit" },
      { permission: "Comment" },
    ]);
    expect(await sharePermissionFor("p1", "u1")).toBe("Edit");
  });

  it("includes the user's groups in the lookup", async () => {
    vi.mocked(listVisibleGroupsForUser).mockResolvedValue([memberGroup("g1")]);
    m.pageShare.findMany.mockResolvedValue([{ permission: "Comment" }]);
    expect(await sharePermissionFor("p1", "u1")).toBe("Comment");
    const where = m.pageShare.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain("g1");
  });

  it("excludes manually-archived groups from the lookup", async () => {
    vi.mocked(listVisibleGroupsForUser).mockResolvedValue([
      memberGroup("g-archived", "2020-01-01T00:00:00.000Z"),
    ]);
    m.pageShare.findMany.mockResolvedValue([]);
    expect(await sharePermissionFor("p1", "u1")).toBeNull();
    const where = m.pageShare.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain("g-archived");
  });
});

describe("groupIdsForUser request memoization", () => {
  // Deriving the user's groups is per-user, but getPageAccess re-derives it once
  // per page. A shared request must collapse it to a single derivation, or the
  // sidebar Favorites/Recents read pays it per page (the dominant navigation-TTFB
  // cost; perf review Aug 2026).
  beforeEach(() => {
    vi.mocked(listVisibleGroupsForUser).mockResolvedValue([memberGroup("g1")]);
    m.pageShare.findMany.mockResolvedValue([]);
  });

  it("derives group membership once across many calls sharing a request", async () => {
    const req = new Request("http://localhost/x");
    await Promise.all(Array.from({ length: 20 }, () => groupIdsForUser("u1", req)));
    expect(listVisibleGroupsForUser).toHaveBeenCalledTimes(1);
  });

  it("sharePermissionFor over many pages resolves groups once with a shared request", async () => {
    const req = new Request("http://localhost/x");
    await Promise.all(
      Array.from({ length: 14 }, (_, i) => sharePermissionFor(`page-${i}`, "u1", req)),
    );
    expect(listVisibleGroupsForUser).toHaveBeenCalledTimes(1);
    // still one pageShare lookup per (distinct) page
    expect(m.pageShare.findMany).toHaveBeenCalledTimes(14);
  });

  it("without a request each call re-derives", async () => {
    await groupIdsForUser("u1");
    await groupIdsForUser("u1");
    expect(listVisibleGroupsForUser).toHaveBeenCalledTimes(2);
  });
});

describe("addPageShare upsert", () => {
  beforeEach(() => {
    m.user.findUnique.mockResolvedValue({ id: "u1" });
  });

  it("creates a new share (changed, not alreadyShared)", async () => {
    m.pageShare.findUnique.mockResolvedValue(null);
    const res = await addPageShare("p1", "actor", "User", "u1", "Edit");
    expect(res).toEqual({ ok: true, alreadyShared: false, changed: true });
    expect(m.pageShare.create).toHaveBeenCalledWith({
      data: { pageId: "p1", principalType: "User", principalId: "u1", permission: "Edit", createdById: "actor" },
    });
  });

  it("is a no-op when re-adding at the same level", async () => {
    m.pageShare.findUnique.mockResolvedValue({ id: "s1", permission: "View" });
    const res = await addPageShare("p1", "actor", "User", "u1", "View");
    expect(res).toEqual({ ok: true, alreadyShared: true, changed: false });
    expect(m.pageShare.update).not.toHaveBeenCalled();
  });

  it("updates the level when re-adding at a different tier (changed)", async () => {
    m.pageShare.findUnique.mockResolvedValue({ id: "s1", permission: "View" });
    const res = await addPageShare("p1", "actor", "User", "u1", "Edit");
    expect(res).toEqual({ ok: true, alreadyShared: true, changed: true });
    expect(m.pageShare.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { permission: "Edit" } });
  });

  it("rejects an unknown user principal", async () => {
    m.user.findUnique.mockResolvedValue(null);
    await expect(addPageShare("p1", "actor", "User", "ghost", "View")).rejects.toBeInstanceOf(
      SharePrincipalError,
    );
  });
});
