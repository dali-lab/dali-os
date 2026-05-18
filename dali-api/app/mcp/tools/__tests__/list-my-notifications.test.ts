import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { runListMyNotifications } from "~/mcp/tools/list-my-notifications";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";
import { LIST_MY_NOTIFICATIONS_TOOL } from "~/mcp/tools/list-my-notifications";

const mockPrisma = prisma as unknown as {
  notification: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_my_notifications", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_MY_NOTIFICATIONS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns shaped notifications and unread count (happy path)", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        kind: "MeetingInvite",
        title: "Invite",
        body: "Now",
        link: "/calendar?meeting=m1",
        readAt: null,
        createdAt: new Date("2026-05-14T10:00:00Z"),
        scheduledMeetingId: "m1",
        rsvp: null,
      },
    ]);
    mockPrisma.notification.count.mockResolvedValue(3);

    const out = await runListMyNotifications("user-1", {});
    expect(out.unreadCount).toBe(3);
    expect(out.notifications).toHaveLength(1);
    expect(out.notifications[0]).toMatchObject({
      id: "n1",
      kind: "MeetingInvite",
      readAt: null,
      createdAt: "2026-05-14T10:00:00.000Z",
    });
  });

  it("respects onlyUnread", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    await runListMyNotifications("user-1", { onlyUnread: true });
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: { recipientUserId: "user-1", readAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  });

  it("rejects invalid input via the dispatcher validator", () => {
    const result = validateInput(
      { limit: 9999 },
      LIST_MY_NOTIFICATIONS_TOOL.inputSchema as JsonSchema,
    );
    expect(result.ok).toBe(false);
  });

  it("returns empty list when user has no notifications", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    const out = await runListMyNotifications("user-1", {});
    expect(out.notifications).toEqual([]);
    expect(out.unreadCount).toBe(0);
  });
});
