import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/db");
vi.mock("~/lib/tasks", async (importOriginal) => ({
  // SELF_CLEARING_FORM_TODO stays real — the mark-all-read test asserts the
  // exact predicate the endpoint excludes.
  SELF_CLEARING_FORM_TODO: (
    await importOriginal<typeof import("~/lib/tasks")>()
  ).SELF_CLEARING_FORM_TODO,
  listOpenTasks: vi.fn(),
  listNotificationHistory: vi.fn(),
}));
vi.mock("~/lib/notifications", async (importOriginal) => ({
  // annotateDesktopFeed stays real — the legacy-payload test covers the
  // desktop/urgent derivation it adds.
  ...(await importOriginal<typeof import("~/lib/notifications")>()),
  listMyNotifications: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import {
  listOpenTasks,
  listNotificationHistory,
  SELF_CLEARING_FORM_TODO,
} from "~/lib/tasks";
import { listMyNotifications } from "~/lib/notifications";
import { loader, action } from "~/routes/api.notifications";

const USER_ID = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as any);
  vi.mocked(listMyNotifications).mockResolvedValue({
    items: [
      { id: "i1", eventType: "meeting.reminder" },
      { id: "i2", eventType: "task.comment" },
    ],
    unreadCount: 2,
  } as any);
  vi.mocked(listOpenTasks).mockResolvedValue([
    { id: "t1", title: "Do it", link: "/x" },
  ] as any);
  vi.mocked(listNotificationHistory).mockResolvedValue({
    items: [{ id: "h1" }],
    nextCursor: null,
    counts: { open: 1, cleared: 4 },
  } as any);
});

function req(query = "") {
  return new Request(`http://localhost/api/notifications${query}`);
}

describe("GET /api/notifications", () => {
  it("returns the legacy payload when no history params are present", async () => {
    const res = await loader({ request: req() } as any);
    const json = await res.json();
    expect(json).toEqual({
      // meeting.reminder is timeSensitive in the registry; both banner by
      // default (no preference rows in the mock).
      items: [
        { id: "i1", eventType: "meeting.reminder", desktop: true, urgent: true },
        { id: "i2", eventType: "task.comment", desktop: true, urgent: false },
      ],
      unreadCount: 2,
      taskCount: 1,
      tasks: [{ id: "t1", title: "Do it", link: "/x" }],
    });
    expect(listNotificationHistory).not.toHaveBeenCalled();
  });

  it("returns the history payload when a history param is present", async () => {
    const res = await loader({ request: req("?status=cleared") } as any);
    const json = await res.json();
    expect(json).toEqual({
      items: [{ id: "h1" }],
      nextCursor: null,
      counts: { open: 1, cleared: 4 },
    });
    expect(listNotificationHistory).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ status: "cleared" }),
    );
    expect(listOpenTasks).not.toHaveBeenCalled();
  });

  it("parses a JSON cursor param", async () => {
    const cursor = JSON.stringify({ createdAt: "2026-05-20T10:00:00.000Z", id: "a" });
    await loader({
      request: req(`?cursor=${encodeURIComponent(cursor)}`),
    } as any);
    expect(listNotificationHistory).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        cursor: { createdAt: "2026-05-20T10:00:00.000Z", id: "a" },
      }),
    );
  });

  it("falls back to first page on a malformed cursor", async () => {
    await loader({ request: req("?cursor=not-json") } as any);
    expect(listNotificationHistory).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ cursor: null }),
    );
  });
});

describe("POST /api/notifications (mark all read)", () => {
  it("leaves self-clearing rows — invites, onboarding, form todos — unread", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    (prisma as any).notification = { updateMany };
    const res = await action({
      request: new Request("http://localhost/api/notifications", {
        method: "POST",
      }),
    } as any);
    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        recipientUserId: USER_ID,
        readAt: null,
        NOT: [
          { kind: "MeetingInvite", scheduledMeetingId: { not: null } },
          { eventType: expect.any(String) },
          SELF_CLEARING_FORM_TODO,
        ],
      },
      data: { readAt: expect.any(Date) },
    });
  });
});
