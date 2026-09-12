import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    scheduledAnnouncement: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { runListAnnouncements, LIST_ANNOUNCEMENTS_TOOL } from "~/mcp/tools/admin/list-announcements";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as {
  scheduledAnnouncement: { findMany: ReturnType<typeof vi.fn> };
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
    expect(out).toEqual({ pending: [], recentlySent: [] });
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
    expect(secondCall.where).toMatchObject({ sentAt: { not: null } });
    expect(secondCall.orderBy).toEqual({ sentAt: "desc" });
    expect(secondCall.take).toBe(20);
  });
});
