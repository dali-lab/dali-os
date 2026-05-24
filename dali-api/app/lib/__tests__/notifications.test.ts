import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { listMyNotifications } from "~/lib/notifications";

const mockPrisma = prisma as unknown as {
  notification: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

// The clause that hides invites whose meeting was Cancelled — every query in
// listMyNotifications must carry it so cancelled invites vanish everywhere.
const NOT_CANCELLED = {
  OR: [
    { scheduledMeetingId: null },
    { scheduledMeeting: { status: { not: "Cancelled" } } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.notification.findMany.mockResolvedValue([]);
  mockPrisma.notification.count.mockResolvedValue(0);
});

describe("listMyNotifications", () => {
  it("excludes cancelled-meeting invites from the default feed", async () => {
    await listMyNotifications("user-1");
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: { recipientUserId: "user-1", ...NOT_CANCELLED },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });

  it("keeps the cancelled filter on the unread count too", async () => {
    await listMyNotifications("user-1");
    expect(mockPrisma.notification.count).toHaveBeenCalledWith({
      where: { recipientUserId: "user-1", readAt: null, ...NOT_CANCELLED },
    });
  });

  it("combines onlyUnread with the cancelled filter", async () => {
    await listMyNotifications("user-1", { onlyUnread: true });
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: { recipientUserId: "user-1", readAt: null, ...NOT_CANCELLED },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });
});
