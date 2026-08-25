import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  listOpenTasks,
  countOpenTasks,
  resolveNotificationState,
  listNotificationHistory,
  type NotifLiveness,
} from "~/lib/tasks";

const mockPrisma = prisma as unknown as {
  notification: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

// Minimal liveness row; override per-case.
function liveness(over: Partial<NotifLiveness> = {}): NotifLiveness {
  return {
    readAt: null,
    dueAt: null,
    formId: null,
    scheduledMeetingId: null,
    scheduledMeeting: null,
    interviewAssignment: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.notification.findMany.mockResolvedValue([]);
  mockPrisma.notification.count.mockResolvedValue(0);
});

// The where clause the Tasks views filter on. Cancelled-meeting invites and
// stale interview-assignment notifications must both be excluded. Past
// MeetingReminder rows (dueAt in the past) and past one-off MeetingInvite rows
// drop off live Tasks too.
function expectedWhere(userId: string) {
  return {
    recipientUserId: userId,
    readAt: null,
    AND: [
      {
        OR: [
          { scheduledMeetingId: null },
          { scheduledMeeting: { status: { not: "Cancelled" } } },
        ],
      },
      {
        OR: [
          { kind: { not: "MeetingReminder" } },
          { dueAt: { gt: expect.any(Date) } },
          {
            AND: [
              { dueAt: null },
              {
                OR: [
                  { scheduledMeeting: { selectedAt: { gt: expect.any(Date) } } },
                  { scheduledMeeting: { selectedAt: null } },
                ],
              },
            ],
          },
        ],
      },
      {
        OR: [
          { kind: { not: "MeetingInvite" } },
          { scheduledMeetingId: null },
          { scheduledMeeting: { recurrenceRule: { not: null } } },
          { scheduledMeeting: { selectedAt: null } },
          { scheduledMeeting: { selectedAt: { gt: expect.any(Date) } } },
        ],
      },
    ],
    OR: [
      { interviewAssignmentId: null },
      { interviewAssignment: { status: "Active", interview: { status: "Scheduled" } } },
    ],
  };
}

describe("listOpenTasks", () => {
  it("filters out cancelled-meeting invites and stale interview tasks", async () => {
    await listOpenTasks("user-1");
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere("user-1") }),
    );
  });

  it("maps a meeting-invite notification to a meeting-source task", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        kind: "MeetingInvite",
        title: "Meeting invite: Standup",
        body: null,
        link: "/calendar?meeting=m1",
        dueAt: null,
        createdAt: new Date("2026-05-20T10:00:00Z"),
        readAt: null,
        formId: null,
        scheduledMeetingId: "m1",
        scheduledMeeting: { selectedAt: new Date("2026-05-22T15:00:00Z"), status: "Scheduled" },
        interviewAssignment: null,
        form: null,
      },
    ]);

    const tasks = await listOpenTasks("user-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "n1",
      source: "meeting",
      dueAt: "2026-05-22T15:00:00.000Z",
      hasAction: true,
    });
  });

  it("does not treat MeetingInvite without scheduledMeetingId as RSVP-able", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([
      {
        id: "n2",
        kind: "MeetingInvite",
        title: "Meeting invite: Orphan",
        body: null,
        link: "/calendar",
        dueAt: null,
        createdAt: new Date("2026-05-20T10:00:00Z"),
        readAt: null,
        formId: null,
        scheduledMeetingId: null,
        scheduledMeeting: null,
        interviewAssignment: null,
        form: null,
      },
    ]);

    const tasks = await listOpenTasks("user-1");
    expect(tasks[0]).toMatchObject({
      id: "n2",
      source: "general",
      hasAction: false,
    });
  });

  it("treats MeetingReminder as dismissible (hasAction false) even with scheduledMeetingId", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([
      {
        id: "n3",
        kind: "MeetingReminder",
        title: "Starting soon: Design sync",
        body: "Starts Fri, May 22, 11:00 AM",
        link: "/calendar?meeting=m1",
        dueAt: new Date("2026-05-22T15:00:00Z"),
        createdAt: new Date("2026-05-22T14:45:00Z"),
        readAt: null,
        formId: null,
        scheduledMeetingId: "m1",
        scheduledMeeting: {
          selectedAt: new Date("2026-05-22T15:00:00Z"),
          status: "Confirmed",
        },
        interviewAssignment: null,
        form: null,
      },
    ]);

    const tasks = await listOpenTasks("user-1");
    expect(tasks[0]).toMatchObject({
      id: "n3",
      source: "reminder",
      hasAction: false,
      dueAt: "2026-05-22T15:00:00.000Z",
    });
  });
});

describe("countOpenTasks", () => {
  it("counts with the same cancelled/interview filter", async () => {
    await countOpenTasks("user-1");
    expect(mockPrisma.notification.count).toHaveBeenCalledWith({
      where: expectedWhere("user-1"),
    });
  });
});

describe("resolveNotificationState", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("unread plain → Open", () => {
    expect(resolveNotificationState(liveness(), now)).toBe("Open");
  });

  it("read plain → Cleared", () => {
    expect(resolveNotificationState(liveness({ readAt: now }), now)).toBe(
      "Cleared",
    );
  });

  it("read with formId → Submitted", () => {
    expect(
      resolveNotificationState(liveness({ readAt: now, formId: "f1" }), now),
    ).toBe("Submitted");
  });

  it("unread with a Cancelled linked meeting → Cancelled", () => {
    expect(
      resolveNotificationState(
        liveness({
          scheduledMeetingId: "m1",
          scheduledMeeting: { status: "Cancelled" },
        }),
        now,
      ),
    ).toBe("Cancelled");
  });

  it("unread with a non-Active interview assignment → Cancelled", () => {
    expect(
      resolveNotificationState(
        liveness({
          interviewAssignment: {
            status: "Declined",
            interview: { status: "Scheduled" },
          },
        }),
        now,
      ),
    ).toBe("Cancelled");
  });

  it("unread past dueAt → Expired", () => {
    expect(
      resolveNotificationState(
        liveness({ dueAt: new Date("2026-05-01T00:00:00Z") }),
        now,
      ),
    ).toBe("Expired");
  });

  it("Cancelled wins over a set readAt", () => {
    expect(
      resolveNotificationState(
        liveness({
          readAt: now,
          scheduledMeetingId: "m1",
          scheduledMeeting: { status: "Cancelled" },
        }),
        now,
      ),
    ).toBe("Cancelled");
  });
});

describe("listNotificationHistory", () => {
  function row(over: Record<string, unknown> = {}) {
    return {
      id: "n1",
      kind: "General",
      title: "Hello",
      body: "World",
      link: "/somewhere",
      dueAt: null,
      readAt: null,
      createdAt: new Date("2026-05-20T10:00:00Z"),
      formId: null,
      scheduledMeetingId: null,
      createdBy: { id: "u9", firstName: "Ada", lastName: "Lovelace" },
      form: null,
      scheduledMeeting: null,
      interviewAssignment: null,
      ...over,
    };
  }

  it("returns items with derived state, sender, and counts", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([row()]);
    mockPrisma.notification.count
      .mockResolvedValueOnce(3) // open
      .mockResolvedValueOnce(7); // cleared

    const res = await listNotificationHistory("user-1");
    expect(res.counts).toEqual({ open: 3, cleared: 7 });
    expect(res.items[0]).toMatchObject({
      id: "n1",
      sender: "Ada Lovelace",
      state: "Open",
      clearedAt: null,
      canRsvp: false,
    });
    expect(res.nextCursor).toBeNull();
  });

  it("status=cleared filters on readAt not null", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    await listNotificationHistory("user-1", { status: "cleared" });
    const call = mockPrisma.notification.findMany.mock.calls[0][0];
    expect(call.where.AND).toContainEqual({ NOT: { readAt: null } });
  });

  it("kind + q compose into the base where", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    await listNotificationHistory("user-1", { kind: "General", q: "budget" });
    const call = mockPrisma.notification.findMany.mock.calls[0][0];
    const base = call.where.AND[0];
    expect(base.kind).toBe("General");
    expect(base.OR).toEqual([
      { title: { contains: "budget", mode: "insensitive" } },
      { body: { contains: "budget", mode: "insensitive" } },
    ]);
  });

  it("clamps limit to 50 and overfetches by one", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    await listNotificationHistory("user-1", { limit: 999 });
    const call = mockPrisma.notification.findMany.mock.calls[0][0];
    expect(call.take).toBe(51);
  });

  it("emits a nextCursor when more rows exist than the limit", async () => {
    // limit 1 → overfetch 2; two rows means hasMore.
    mockPrisma.notification.findMany.mockResolvedValue([
      row({ id: "a", createdAt: new Date("2026-05-20T10:00:00Z") }),
      row({ id: "b", createdAt: new Date("2026-05-19T10:00:00Z") }),
    ]);
    const res = await listNotificationHistory("user-1", { limit: 1 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe("a");
    expect(res.nextCursor).toEqual({
      createdAt: "2026-05-20T10:00:00.000Z",
      id: "a",
    });
  });

  it("links a Submitted form row to its fill page", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([
      row({
        readAt: new Date("2026-05-21T10:00:00Z"),
        formId: "f1",
        form: { published: true, publicToken: "tok123" },
      }),
    ]);
    const res = await listNotificationHistory("user-1");
    expect(res.items[0].state).toBe("Submitted");
    expect(res.items[0].link).toBe("/forms/fill/tok123");
  });
});
