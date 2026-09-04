import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  listMyNotifications,
  liveMeetingPingClauses,
  NOT_CANCELLED_MEETING,
} from "~/lib/notifications";

const mockPrisma = prisma as unknown as {
  notification: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

// Frozen so the `now` baked into the staleness clauses is reproducible.
const NOW = new Date("2026-09-04T12:00:00.000Z");

// The clause that hides invites whose meeting was Cancelled — every query in
// listMyNotifications must carry it so cancelled invites vanish everywhere.
const NOT_CANCELLED = NOT_CANCELLED_MEETING;
// The staleness hides shared with TASK_WHERE: a "Starting soon" reminder whose
// occurrence has begun, and an un-RSVP'd invite to a one-off that already
// happened. Without these on this path the desktop dock badge keeps counting
// rows the web bell has already dropped.
const LIVE = () => liveMeetingPingClauses(NOW);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mockPrisma.notification.findMany.mockResolvedValue([]);
  mockPrisma.notification.count.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("liveMeetingPingClauses", () => {
  it("hides a MeetingReminder once its occurrence start has passed", () => {
    const [reminder] = liveMeetingPingClauses(NOW);
    expect(reminder).toEqual({
      OR: [
        { kind: { not: "MeetingReminder" } },
        { dueAt: { gt: NOW } },
        {
          AND: [
            { dueAt: null },
            {
              OR: [
                { scheduledMeeting: { selectedAt: { gt: NOW } } },
                { scheduledMeeting: { selectedAt: null } },
              ],
            },
          ],
        },
      ],
    });
  });

  it("hides an un-RSVP'd one-off invite whose meeting already happened", () => {
    const [, invite] = liveMeetingPingClauses(NOW);
    expect(invite).toEqual({
      OR: [
        { kind: { not: "MeetingInvite" } },
        { scheduledMeetingId: null },
        { scheduledMeeting: { recurrenceRule: { not: null } } },
        { scheduledMeeting: { selectedAt: null } },
        { scheduledMeeting: { selectedAt: { gt: NOW } } },
      ],
    });
  });
});

describe("listMyNotifications", () => {
  it("excludes cancelled-meeting invites and stale pings from the default feed", async () => {
    await listMyNotifications("user-1");
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: {
        recipientUserId: "user-1",
        AND: [
          NOT_CANCELLED,
          { OR: [{ readAt: { not: null } }, { AND: LIVE() }] },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });

  it("keeps a read row in the feed even once it has gone stale", async () => {
    await listMyNotifications("user-1");
    const { where } = mockPrisma.notification.findMany.mock.calls[0][0];
    // The staleness branch is OR'd with "already read", so the desktop app
    // still sees readAt on these rows and can retire its delivered banners.
    expect(where.AND[1].OR[0]).toEqual({ readAt: { not: null } });
  });

  it("keeps the cancelled and staleness filters on the unread count too", async () => {
    await listMyNotifications("user-1");
    expect(mockPrisma.notification.count).toHaveBeenCalledWith({
      where: {
        recipientUserId: "user-1",
        readAt: null,
        AND: [NOT_CANCELLED, ...LIVE()],
      },
    });
  });

  it("combines onlyUnread with the cancelled and staleness filters", async () => {
    await listMyNotifications("user-1", { onlyUnread: true });
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: {
        recipientUserId: "user-1",
        readAt: null,
        AND: [
          NOT_CANCELLED,
          { OR: [{ readAt: { not: null } }, { AND: LIVE() }] },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });
});
