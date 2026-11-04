import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    scheduledAnnouncement: { findMany: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { runListAnnouncements, LIST_ANNOUNCEMENTS_TOOL } from "~/mcp/tools/admin/list-announcements";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as {
  scheduledAnnouncement: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

function makeCtx(userId = "u-core"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Core",
      lastName: "Lead",
    },
    scopes: ["mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

const BASE_SA = {
  id: "sa-1",
  title: "Test Announcement",
  sendAt: new Date("2026-10-01T10:00:00Z"),
  sentAt: null,
  allMembers: true,
  groupIds: [],
  userIds: [],
  lastError: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  // Default: empty arrays for both queries
  mockPrisma.scheduledAnnouncement.findMany.mockResolvedValue([]);
  mockPrisma.scheduledAnnouncement.count.mockResolvedValue(0);
});

describe("list_announcements", () => {
  it("requires the mcp:admin scope", () => {
    expect(LIST_ANNOUNCEMENTS_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(runListAnnouncements(makeCtx("u-nobody"))).rejects.toMatchObject({
      name: "McpForbiddenError",
      status: 403,
    });
    expect(mockPrisma.scheduledAnnouncement.findMany).not.toHaveBeenCalled();
  });

  it("returns empty pending and recentlySent when there are no announcements", async () => {
    const out = await runListAnnouncements(makeCtx());
    expect(out).toEqual({
      pending: [],
      pendingTotal: 0,
      page: { nextCursor: null, hasMore: false, limit: 20 },
      recentlySent: [],
    });
    expect(mockPrisma.scheduledAnnouncement.findMany).toHaveBeenCalledTimes(2);
  });

  it("maps pending announcements correctly", async () => {
    mockPrisma.scheduledAnnouncement.findMany
      .mockResolvedValueOnce([{ ...BASE_SA, groupIds: ["g1", "g2"], userIds: ["u1"] }])
      .mockResolvedValueOnce([]);

    const out = await runListAnnouncements(makeCtx());
    expect(out.pending).toHaveLength(1);
    expect(out.pending[0]).toMatchObject({
      id: "sa-1",
      title: "Test Announcement",
      sendAt: "2026-10-01T10:00:00.000Z",
      sentAt: null,
      allMembers: true,
      groupCount: 2,
      userCount: 1,
      lastError: null,
    });
    expect(out.recentlySent).toHaveLength(0);
  });

  it("maps recentlySent announcements with sentAt correctly", async () => {
    const sentRow = {
      ...BASE_SA,
      id: "sa-2",
      sentAt: new Date("2026-09-15T08:00:00Z"),
    };
    mockPrisma.scheduledAnnouncement.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sentRow]);

    const out = await runListAnnouncements(makeCtx());
    expect(out.pending).toHaveLength(0);
    expect(out.recentlySent).toHaveLength(1);
    expect(out.recentlySent[0]).toMatchObject({
      id: "sa-2",
      sentAt: "2026-09-15T08:00:00.000Z",
    });
  });

  it("queries pending with correct filters (no sentAt, no canceledAt)", async () => {
    await runListAnnouncements(makeCtx());
    const firstCall = mockPrisma.scheduledAnnouncement.findMany.mock.calls[0][0];
    expect(firstCall.where).toMatchObject({ canceledAt: null, sentAt: null });
    expect(firstCall.orderBy).toEqual({ sendAt: "asc" });
    expect(firstCall.take).toBe(20);
  });

  it("queries recently sent with correct filters (sentAt not null, desc order)", async () => {
    await runListAnnouncements(makeCtx());
    const secondCall = mockPrisma.scheduledAnnouncement.findMany.mock.calls[1][0];
    expect(secondCall.where.AND[0]).toEqual({ sentAt: { not: null } });
    expect(secondCall.orderBy).toEqual([{ sentAt: "desc" }, { id: "desc" }]);
    expect(secondCall.take).toBe(21);
  });

  it("reports how many announcements are pending beyond the 20 shown", async () => {
    mockPrisma.scheduledAnnouncement.count.mockResolvedValue(35);
    const out = await runListAnnouncements(makeCtx());
    expect(out.pendingTotal).toBe(35);
    expect(mockPrisma.scheduledAnnouncement.count).toHaveBeenCalledWith({
      where: { canceledAt: null, sentAt: null },
    });
  });

  it("walks recentlySent with the cursor and ends with a null cursor", async () => {
    const sent = (id: string, day: number) => ({
      ...BASE_SA,
      id,
      sentAt: new Date(`2026-09-${String(day).padStart(2, "0")}T08:00:00Z`),
    });
    mockPrisma.scheduledAnnouncement.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sent("sa-3", 3), sent("sa-2", 2), sent("sa-1", 1)]);

    const first = await runListAnnouncements(makeCtx(), { limit: 2 });
    expect(first.recentlySent.map((r) => r.id)).toEqual(["sa-3", "sa-2"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2 });

    mockPrisma.scheduledAnnouncement.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sent("sa-1", 1)]);
    const second = await runListAnnouncements(makeCtx(), { limit: 2, cursor: first.page.nextCursor! });
    expect(second.recentlySent.map((r) => r.id)).toEqual(["sa-1"]);
    expect(second.page).toEqual({ nextCursor: null, hasMore: false, limit: 2 });
    const sentCall = mockPrisma.scheduledAnnouncement.findMany.mock.calls[3][0];
    expect(sentCall.where.AND[1]).toEqual({
      OR: [
        { sentAt: { lt: new Date("2026-09-02T08:00:00Z") } },
        { sentAt: new Date("2026-09-02T08:00:00Z"), id: { lt: "sa-2" } },
      ],
    });
  });
});
