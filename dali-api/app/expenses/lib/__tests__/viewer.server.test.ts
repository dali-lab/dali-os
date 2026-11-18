import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: { expenseCard: { findMany: vi.fn() } },
  getUserRoles: vi.fn(),
  listVisibleGroupIdsForUser: vi.fn(),
}));
vi.mock("~/lib/db.server", () => ({ prisma: m.prisma }));
vi.mock("~/lib/roles", () => ({ getUserRoles: m.getUserRoles }));
vi.mock("~/lib/groups.server", () => ({ listVisibleGroupIdsForUser: m.listVisibleGroupIdsForUser }));

import { loadExpenseViewer } from "../viewer.server";

beforeEach(() => {
  vi.clearAllMocks();
  m.getUserRoles.mockResolvedValue({ isCore: false, isStaff: true });
  m.prisma.expenseCard.findMany.mockResolvedValue([{ id: "c1" }]);
  m.listVisibleGroupIdsForUser.mockResolvedValue([
    { id: "g1", archivedAt: null },
    { id: "g2", archivedAt: new Date("2026-01-01") },
  ]);
});

describe("loadExpenseViewer", () => {
  it("loads roles, owned cards and every group the user is in", async () => {
    const request = new Request("http://localhost/expenses");
    expect(await loadExpenseViewer("u1", request)).toEqual({
      userId: "u1",
      isCore: false,
      isStaff: true,
      ownedCardIds: ["c1"],
      groupIds: ["g1", "g2"],
    });
    expect(m.prisma.expenseCard.findMany).toHaveBeenCalledWith({ where: { ownerId: "u1" }, select: { id: true } });
    expect(m.listVisibleGroupIdsForUser).toHaveBeenCalledWith("u1", request);
  });
});
