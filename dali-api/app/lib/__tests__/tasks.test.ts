import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  listOpenTasks,
  listOpenTasksPage,
  openTasksTotal,
  countMyProjectTasks,
  listMyProjectTasksPage,
  projectTasksTotal,
  parseOffsetCursor,
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
  task: {
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
  mockPrisma.task.findMany.mockResolvedValue([]);
  mockPrisma.task.count.mockResolvedValue(0);
});

function notifRow(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `n${i}`,
    kind: "SystemAnnouncement",
    eventType: null,
    isTodo: false,
    title: `Task ${i}`,
    body: null,
    link: null,
    dueAt: null,
    createdAt: new Date(Date.UTC(2026, 4, 20, 10, 0, 60 - i)),
    readAt: null,
    formId: null,
    scheduledMeetingId: null,
    scheduledMeeting: null,
    interviewAssignment: null,
    form: null,
    ...over,
  };
}

function projectRow(i: number) {
  return {
    id: `p${i}`,
    title: `Work ${i}`,
    status: "Todo",
    dueAt: null,
    activityAt: new Date("2026-05-20T10:00:00Z"),
    projectId: "proj-1",
    project: { name: "Atlas" },
  };
}

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
      {
        OR: [
          { interviewAssignmentId: null },
          { interviewAssignment: { status: "Active", interview: { status: "Scheduled" } } },
        ],
      },
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


describe("listOpenTasksPage", () => {
  it("sorts newest first with id as the tiebreak and fetches one extra row", async () => {
    await listOpenTasksPage("user-1", { limit: 2 });
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere("user-1"),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 3,
      }),
    );
  });

  it("returns a cursor only when a row is left over, and trims the extra row", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([notifRow(1), notifRow(2), notifRow(3)]);
    const page = await listOpenTasksPage("user-1", { limit: 2 });
    expect(page.items.map((t) => t.id)).toEqual(["n1", "n2"]);
    expect(page.nextCursor).toBe(`${notifRow(2).createdAt.toISOString()}|n2`);

    mockPrisma.notification.findMany.mockResolvedValue([notifRow(1), notifRow(2)]);
    expect((await listOpenTasksPage("user-1", { limit: 2 })).nextCursor).toBeNull();
  });

  it("keeps the task predicate and adds the keyset when given a cursor", async () => {
    const cursor = `${notifRow(2).createdAt.toISOString()}|n2`;
    await listOpenTasksPage("user-1", { cursor, limit: 2 });
    const { where } = mockPrisma.notification.findMany.mock.calls[0][0];
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0]).toEqual(expectedWhere("user-1"));
    expect(where.AND[1]).toEqual({
      OR: [
        { createdAt: { lt: notifRow(2).createdAt } },
        { createdAt: notifRow(2).createdAt, id: { lt: "n2" } },
      ],
    });
  });

  it("does not drop a row the where clause admitted", async () => {
    // Expired reminders and read-state rows pass the DB predicate; the page
    // must not filter further, or its length would drift from countOpenTasks.
    const rows = [
      notifRow(1, { kind: "MeetingReminder", dueAt: new Date("2026-05-22T15:00:00Z") }),
      notifRow(2, { kind: "MeetingInvite", scheduledMeetingId: "m1", scheduledMeeting: { selectedAt: null, status: "Scheduled" } }),
      notifRow(3, { interviewAssignment: { status: "Active", interview: { status: "Scheduled" } } }),
    ];
    mockPrisma.notification.findMany.mockResolvedValue(rows);
    const page = await listOpenTasksPage("user-1");
    expect(page.items).toHaveLength(rows.length);
  });
});

describe("listOpenTasks", () => {
  it("is the first page's items", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([notifRow(1)]);
    expect((await listOpenTasks("user-1")).map((t) => t.id)).toEqual(["n1"]);
  });
});

describe("openTasksTotal", () => {
  it("skips the count query when the page was the whole list", async () => {
    const page = { items: [{ id: "a" }, { id: "b" }], nextCursor: null } as any;
    expect(await openTasksTotal("user-1", page)).toBe(2);
    expect(mockPrisma.notification.count).not.toHaveBeenCalled();
  });

  it("counts when more rows exist", async () => {
    mockPrisma.notification.count.mockResolvedValue(120);
    const page = { items: [{ id: "a" }], nextCursor: "x|y" } as any;
    expect(await openTasksTotal("user-1", page)).toBe(120);
    expect(mockPrisma.notification.count).toHaveBeenCalledWith({ where: expectedWhere("user-1") });
  });
});

describe("project tasks", () => {
  const where = {
    assignees: { some: { userId: "user-1" } },
    status: { in: ["Todo", "InProgress", "InReview"] },
    archivedAt: null,
    project: { status: { not: "Archived" } },
  };

  it("counts with the same predicate the list uses", async () => {
    await countMyProjectTasks("user-1");
    expect(mockPrisma.task.count).toHaveBeenCalledWith({ where });
    await listMyProjectTasksPage("user-1");
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
  });

  it("sorts by deadline, then newest, then id, and skips by the offset cursor", async () => {
    await listMyProjectTasksPage("user-1", { cursor: "50", limit: 50 });
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
        skip: 50,
        take: 51,
      }),
    );
  });

  it("returns the next offset only when a row is left over", async () => {
    mockPrisma.task.findMany.mockResolvedValue([projectRow(1), projectRow(2), projectRow(3)]);
    const page = await listMyProjectTasksPage("user-1", { cursor: "4", limit: 2 });
    expect(page.items.map((t) => t.id)).toEqual(["p1", "p2"]);
    expect(page.nextCursor).toBe("6");
    expect(page.items[0]).toMatchObject({ projectName: "Atlas", link: "/projects/proj-1?tab=board&task=p1" });

    mockPrisma.task.findMany.mockResolvedValue([projectRow(1)]);
    expect((await listMyProjectTasksPage("user-1", { limit: 2 })).nextCursor).toBeNull();
  });

  it("reads a bad offset cursor as the first page", () => {
    expect(parseOffsetCursor("12")).toBe(12);
    for (const bad of [null, undefined, "", "abc", "-5", "1.5", "0"]) expect(parseOffsetCursor(bad)).toBe(0);
  });

  it("counts only when more rows exist", async () => {
    mockPrisma.task.count.mockResolvedValue(75);
    expect(await projectTasksTotal("user-1", { items: [{ id: "a" }], nextCursor: null } as any)).toBe(1);
    expect(mockPrisma.task.count).not.toHaveBeenCalled();
    expect(await projectTasksTotal("user-1", { items: [{ id: "a" }], nextCursor: "50" } as any)).toBe(75);
  });
});
