import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { liveMeetingPingClauses, NOT_CANCELLED_MEETING } from "~/lib/notifications";
import { runListMyNotifications, LIST_MY_NOTIFICATIONS_TOOL } from "~/mcp/tools/list-my-notifications";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";

const mockPrisma = prisma as unknown as {
  notification: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

// Frozen so the `now` baked into the staleness clauses is reproducible.
const NOW = new Date("2026-09-04T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("list_my_notifications", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_MY_NOTIFICATIONS_TOOL.requiredScope).toBe("mcp:read");
  });

  // ── Inbox mode ────────────────────────────────────────────────────────────

  it("inbox: returns shaped notifications and unread count (happy path)", async () => {
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
    expect(out.mode).toBe("inbox");
    if (out.mode !== "inbox") return;
    expect(out.unreadCount).toBe(3);
    expect(out.notifications).toHaveLength(1);
    expect(out.notifications[0]).toMatchObject({
      id: "n1",
      kind: "MeetingInvite",
      readAt: null,
      createdAt: "2026-05-14T10:00:00.000Z",
    });
  });

  it("inbox: respects onlyUnread flag", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    await runListMyNotifications("user-1", { onlyUnread: true });
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: {
        recipientUserId: "user-1",
        readAt: null,
        AND: [
          NOT_CANCELLED_MEETING,
          {
            OR: [
              { readAt: { not: null } },
              { AND: liveMeetingPingClauses(NOW) },
            ],
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 21,
    });
  });

  it("inbox: reports hasMore without a cursor when more items exist", async () => {
    const row = (id: string) => ({
      id,
      kind: "General",
      title: id,
      body: null,
      link: null,
      readAt: null,
      createdAt: new Date("2026-05-14T10:00:00Z"),
      scheduledMeetingId: null,
      rsvp: null,
    });
    mockPrisma.notification.findMany.mockResolvedValue([row("a"), row("b")]);
    mockPrisma.notification.count.mockResolvedValue(2);
    const out = await runListMyNotifications("user-1", { limit: 1 });
    if (out.mode !== "inbox") throw new Error("expected inbox");
    expect(out.notifications.map((n) => n.id)).toEqual(["a"]);
    expect(out.page).toEqual({ nextCursor: null, hasMore: true, limit: 1 });
    expect(mockPrisma.notification.findMany.mock.calls[0][0].take).toBe(2);
  });

  it("inbox: the largest page still detects more", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);
    await runListMyNotifications("user-1", { limit: 50 });
    expect(mockPrisma.notification.findMany.mock.calls[0][0].take).toBe(51);
  });

  it("inbox: returns empty list when user has no notifications", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    const out = await runListMyNotifications("user-1", {});
    expect(out.mode).toBe("inbox");
    if (out.mode !== "inbox") return;
    expect(out.notifications).toEqual([]);
    expect(out.unreadCount).toBe(0);
  });

  it("rejects invalid limit via the schema validator", () => {
    const result = validateInput(
      { limit: 9999 },
      LIST_MY_NOTIFICATIONS_TOOL.inputSchema as JsonSchema,
    );
    expect(result.ok).toBe(false);
  });

  // ── History mode ──────────────────────────────────────────────────────────

  it("history: switches to history mode when status param is present", async () => {
    const createdAt = "2026-09-01T10:00:00.000Z";
    mockPrisma.notification.findMany.mockResolvedValue([
      {
        id: "n2",
        kind: "General",
        title: "Hello",
        body: null,
        link: null,
        readAt: new Date("2026-09-02T00:00:00Z"),
        createdAt: new Date(createdAt),
        formId: null,
        dueAt: null,
        scheduledMeetingId: null,
        createdBy: null,
        form: null,
        scheduledMeeting: null,
        interviewAssignment: null,
      },
    ]);
    mockPrisma.notification.count
      .mockResolvedValueOnce(0) // open count
      .mockResolvedValueOnce(1); // cleared count

    const out = await runListMyNotifications("user-1", { status: "cleared" });
    expect(out.mode).toBe("history");
    if (out.mode !== "history") return;
    expect(out.counts.cleared).toBe(1);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe("n2");
    expect(out.page).toEqual({ nextCursor: null, hasMore: false, limit: 30 });
  });

  it("history: switches to history mode when q param is present", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    const out = await runListMyNotifications("user-1", { q: "meeting" });
    expect(out.mode).toBe("history");
  });

  it("history: switches to history mode when kind param is present", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    const out = await runListMyNotifications("user-1", { kind: "MeetingInvite" });
    expect(out.mode).toBe("history");
  });

  it("history: walks pages with the shared cursor on (createdAt, id)", async () => {
    const row = (id: string, createdAt: string) => ({
      id,
      kind: "General",
      title: id,
      body: null,
      link: null,
      readAt: null,
      createdAt: new Date(createdAt),
      formId: null,
      dueAt: null,
      scheduledMeetingId: null,
      createdBy: null,
      form: null,
      scheduledMeeting: null,
      interviewAssignment: null,
    });
    mockPrisma.notification.count.mockResolvedValue(0);
    mockPrisma.notification.findMany.mockResolvedValueOnce([
      row("n3", "2026-09-03T00:00:00.000Z"),
      row("n2", "2026-09-02T00:00:00.000Z"),
    ]);
    const first = await runListMyNotifications("user-1", { status: "all", limit: 1 });
    if (first.mode !== "history") throw new Error("expected history");
    expect(first.items.map((i) => i.id)).toEqual(["n3"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 1 });
    expect(first).not.toHaveProperty("nextCursor");

    mockPrisma.notification.findMany.mockResolvedValueOnce([row("n2", "2026-09-02T00:00:00.000Z")]);
    const second = await runListMyNotifications("user-1", {
      status: "all",
      limit: 1,
      cursor: first.page.nextCursor!,
    });
    const where = JSON.stringify(mockPrisma.notification.findMany.mock.calls[1][0].where);
    expect(where).toContain("2026-09-03T00:00:00.000Z");
    expect(where).toContain("n3");
    if (second.mode !== "history") throw new Error("expected history");
    expect(second.items.map((i) => i.id)).toEqual(["n2"]);
    expect(second.page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("history: a malformed cursor is an error", async () => {
    await expect(
      runListMyNotifications("user-1", { status: "all", cursor: "not-json{" }),
    ).rejects.toThrow(/Invalid cursor/);
    expect(mockPrisma.notification.findMany).not.toHaveBeenCalled();
  });

  it("history: limit alone (no semantic history param) stays in inbox mode", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    const out = await runListMyNotifications("user-1", { limit: 10 });
    expect(out.mode).toBe("inbox");
  });
});
