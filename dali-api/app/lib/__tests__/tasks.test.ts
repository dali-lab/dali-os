import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { listOpenTasks, countOpenTasks } from "~/lib/tasks";

const mockPrisma = prisma as unknown as {
  notification: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.notification.findMany.mockResolvedValue([]);
  mockPrisma.notification.count.mockResolvedValue(0);
});

// The where clause the Tasks views filter on. Cancelled-meeting invites and
// stale interview-assignment notifications must both be excluded.
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
        scheduledMeeting: { selectedAt: new Date("2026-05-22T15:00:00Z") },
        form: null,
      },
    ]);

    const tasks = await listOpenTasks("user-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "n1",
      source: "meeting",
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
