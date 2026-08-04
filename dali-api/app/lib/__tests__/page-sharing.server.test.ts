import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    groupDefinition: { findMany: vi.fn(), findUnique: vi.fn() },
    pageShare: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn().mockResolvedValue([]) }));

import { prisma } from "~/lib/db";
import { resolveGroupMembers } from "~/lib/groups";
import {
  permissionAtLeast,
  sharePermissionFor,
  addPageShare,
  SharePrincipalError,
} from "../page-sharing.server";

const m = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  m.groupDefinition.findMany.mockResolvedValue([]);
  m.pageShare.findMany.mockResolvedValue([]);
  vi.mocked(resolveGroupMembers).mockResolvedValue([]);
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
    m.groupDefinition.findMany.mockResolvedValue([{ id: "g1" }]);
    vi.mocked(resolveGroupMembers).mockResolvedValue(["u1"]);
    m.pageShare.findMany.mockResolvedValue([{ permission: "Comment" }]);
    expect(await sharePermissionFor("p1", "u1")).toBe("Comment");
    const where = m.pageShare.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain("g1");
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
