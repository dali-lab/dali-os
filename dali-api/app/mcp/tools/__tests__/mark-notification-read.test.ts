import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  runMarkNotificationRead,
  MARK_NOTIFICATION_READ_TOOL,
  NotificationNotFoundError,
  NotificationForbiddenError,
} from "~/mcp/tools/mark-notification-read";

const mockPrisma = prisma as unknown as {
  notification: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mark_notification_read", () => {
  it("requires the mcp:write scope", () => {
    expect(MARK_NOTIFICATION_READ_TOOL.requiredScope).toBe("mcp:write");
  });

  it("marks a non-meeting notification read", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u1",
      readAt: null,
      scheduledMeetingId: null,
    });
    mockPrisma.notification.update.mockResolvedValue({});
    const out = await runMarkNotificationRead("u1", { notificationId: "n1" });
    expect(out).toEqual({ ok: true, alreadyRead: false });
    expect(mockPrisma.notification.update).toHaveBeenCalled();
  });

  it("skips a meeting-invite notification", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u1",
      readAt: null,
      scheduledMeetingId: "m1",
    });
    const out = await runMarkNotificationRead("u1", { notificationId: "n1" });
    expect(out).toEqual({ ok: true, skipped: "meeting-invite" });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it("is idempotent for already-read", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u1",
      readAt: new Date(),
      scheduledMeetingId: null,
    });
    const out = await runMarkNotificationRead("u1", { notificationId: "n1" });
    expect(out).toEqual({ ok: true, alreadyRead: true });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it("rejects unknown notification", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue(null);
    await expect(
      runMarkNotificationRead("u1", { notificationId: "nope" }),
    ).rejects.toBeInstanceOf(NotificationNotFoundError);
  });

  it("rejects notifications belonging to another user", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u2",
      readAt: null,
      scheduledMeetingId: null,
    });
    await expect(
      runMarkNotificationRead("u1", { notificationId: "n1" }),
    ).rejects.toBeInstanceOf(NotificationForbiddenError);
  });
});
