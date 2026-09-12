import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify-stream.server", () => ({
  publishNotificationChange: vi.fn(),
}));
vi.mock("~/members/lib/welcome.server", () => ({
  ONBOARDING_EVENT_TYPE: "member.onboarding",
}));

import { prisma } from "~/lib/db";
import { publishNotificationChange } from "~/lib/notify-stream.server";
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
    updateMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mark_notification_read", () => {
  it("requires the mcp:write scope", () => {
    expect(MARK_NOTIFICATION_READ_TOOL.requiredScope).toBe("mcp:write");
  });

  // ── Single-notification: original read path ──────────────────────────────

  it("marks a non-meeting notification read", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u1",
      readAt: null,
      kind: "General",
      eventType: "general",
      scheduledMeetingId: null,
      isTodo: false,
      form: null,
    });
    mockPrisma.notification.update.mockResolvedValue({});
    const out = await runMarkNotificationRead("u1", { notificationId: "n1" });
    expect(out).toEqual({ ok: true, alreadyRead: false });
    expect(mockPrisma.notification.update).toHaveBeenCalled();
    expect(publishNotificationChange).toHaveBeenCalledWith(["u1"]);
  });

  it("skips a meeting-invite notification", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u1",
      readAt: null,
      kind: "MeetingInvite",
      eventType: "meeting.invite",
      scheduledMeetingId: "m1",
      isTodo: false,
      form: null,
    });
    const out = await runMarkNotificationRead("u1", { notificationId: "n1" });
    expect(out).toEqual({ ok: true, skipped: "meeting-invite" });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it("skips an onboarding todo", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u1",
      readAt: null,
      kind: "SystemAnnouncement",
      eventType: "member.onboarding",
      scheduledMeetingId: null,
      isTodo: true,
      form: null,
    });
    const out = await runMarkNotificationRead("u1", { notificationId: "n1" });
    expect(out).toEqual({ ok: true, skipped: "onboarding" });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it("marks a MeetingReminder read even when it has scheduledMeetingId", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u1",
      readAt: null,
      kind: "MeetingReminder",
      eventType: "meeting.reminder",
      scheduledMeetingId: "m1",
      isTodo: false,
      form: null,
    });
    mockPrisma.notification.update.mockResolvedValue({});
    const out = await runMarkNotificationRead("u1", { notificationId: "n1" });
    expect(out).toEqual({ ok: true, alreadyRead: false });
    expect(mockPrisma.notification.update).toHaveBeenCalled();
  });

  it("is idempotent for already-read notifications", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u1",
      readAt: new Date(),
      kind: "General",
      eventType: "general",
      scheduledMeetingId: null,
      isTodo: false,
      form: null,
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
      kind: "General",
      eventType: "general",
      scheduledMeetingId: null,
      isTodo: false,
      form: null,
    });
    await expect(
      runMarkNotificationRead("u1", { notificationId: "n1" }),
    ).rejects.toBeInstanceOf(NotificationForbiddenError);
  });

  // ── Form todo handling ────────────────────────────────────────────────────

  it("skips a self-clearing form todo without dismiss intent", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u1",
      readAt: null,
      kind: "SystemAnnouncement",
      eventType: "form.todo",
      scheduledMeetingId: null,
      isTodo: true,
      form: { published: true, publicToken: "tok" },
    });
    const out = await runMarkNotificationRead("u1", { notificationId: "n1" });
    expect(out).toEqual({ ok: true, skipped: "form-todo" });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it("force-clears a form todo with intent=dismiss", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u1",
      readAt: null,
      kind: "SystemAnnouncement",
      eventType: "form.todo",
      scheduledMeetingId: null,
      isTodo: true,
      form: { published: true, publicToken: "tok" },
    });
    mockPrisma.notification.update.mockResolvedValue({});
    const out = await runMarkNotificationRead("u1", { notificationId: "n1", intent: "dismiss" });
    expect(out).toEqual({ ok: true, alreadyRead: false });
    expect(mockPrisma.notification.update).toHaveBeenCalled();
  });

  // ── intent=unread ─────────────────────────────────────────────────────────

  it("re-opens a cleared notification with intent=unread", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u1",
      readAt: new Date("2026-09-01T00:00:00Z"),
      kind: "General",
      eventType: "general",
      scheduledMeetingId: null,
      isTodo: false,
      form: null,
    });
    mockPrisma.notification.update.mockResolvedValue({});
    const out = await runMarkNotificationRead("u1", { notificationId: "n1", intent: "unread" });
    expect(out).toEqual({ ok: true, alreadyRead: false });
    expect(mockPrisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { readAt: null } }),
    );
  });

  it("no-ops intent=unread on a meeting-invite (returns skipped)", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "u1",
      readAt: new Date(),
      kind: "MeetingInvite",
      eventType: "meeting.invite",
      scheduledMeetingId: "m1",
      isTodo: false,
      form: null,
    });
    const out = await runMarkNotificationRead("u1", { notificationId: "n1", intent: "unread" });
    expect(out).toEqual({ ok: true, skipped: "meeting-invite" });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  // ── all=true bulk-clear ───────────────────────────────────────────────────

  it("bulk-clears eligible notifications when all=true", async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 5 });
    const out = await runMarkNotificationRead("u1", { all: true });
    expect(out).toEqual({ ok: true, cleared: 5 });
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ recipientUserId: "u1", readAt: null }),
        data: { readAt: expect.any(Date) },
      }),
    );
    expect(publishNotificationChange).toHaveBeenCalledWith(["u1"]);
    // Single-notification path must NOT fire.
    expect(mockPrisma.notification.findUnique).not.toHaveBeenCalled();
  });

  it("bulk-clear returns cleared:0 when nothing to clear", async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
    const out = await runMarkNotificationRead("u1", { all: true });
    expect(out).toEqual({ ok: true, cleared: 0 });
  });

  it("throws when neither notificationId nor all=true is provided", async () => {
    await expect(
      runMarkNotificationRead("u1", {}),
    ).rejects.toThrow("notificationId is required");
  });
});
