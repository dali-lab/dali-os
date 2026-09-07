import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { zonedDayEndUtc, APPLICATION_TZ } from "~/lib/timezone";
import {
  computeDueReminders,
  runTaskDueReminders,
} from "~/jobs/task-due-reminders.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;

const HOUR = 3_600_000;

// dueAt is a date-only value stored as UTC midnight of the due day; the deadline
// the reminder windows fire against is the end of that calendar day in the lab
// timezone. DEADLINE is computed the same way the job does so the assertions
// stay DST-correct.
const DUE_DAY = new Date("2026-07-15T00:00:00.000Z");
const DEADLINE = zonedDayEndUtc(2026, 7, 15, APPLICATION_TZ);

function task(dueAt: Date, assigneeIds = ["u1"]) {
  return { id: "t1", dueAt, assigneeIds };
}

describe("computeDueReminders", () => {
  it("fires DayBefore inside [deadline-24h, deadline-24h+6h)", () => {
    // Window opened 1h ago.
    const now = new Date(DEADLINE.getTime() - 24 * HOUR + HOUR);
    expect(computeDueReminders(now, [task(DUE_DAY)])).toEqual([
      { taskId: "t1", userId: "u1", kind: "DayBefore", dueAtSnapshot: DUE_DAY },
    ]);
  });

  it("does not fire DayBefore before the window opens", () => {
    const now = new Date(DEADLINE.getTime() - 25 * HOUR);
    expect(computeDueReminders(now, [task(DUE_DAY)])).toEqual([]);
  });

  it("expires DayBefore after the 6h catch-up bound", () => {
    // Window opened 7h ago.
    const now = new Date(DEADLINE.getTime() - 24 * HOUR + 7 * HOUR);
    expect(computeDueReminders(now, [task(DUE_DAY)])).toEqual([]);
  });

  it("fires AtDeadline inside [deadline, deadline+6h) but not before", () => {
    const justDue = new Date(DEADLINE.getTime() + HOUR);
    expect(computeDueReminders(justDue, [task(DUE_DAY)])).toEqual([
      { taskId: "t1", userId: "u1", kind: "AtDeadline", dueAtSnapshot: DUE_DAY },
    ]);

    const notYet = new Date(DEADLINE.getTime() - HOUR);
    expect(
      computeDueReminders(notYet, [task(DUE_DAY)]).filter((t) => t.kind === "AtDeadline"),
    ).toEqual([]);

    const longPast = new Date(DEADLINE.getTime() + 7 * HOUR);
    expect(computeDueReminders(longPast, [task(DUE_DAY)])).toEqual([]);
  });

  it("boundary: exactly at the deadline fires AtDeadline, exactly at window end does not", () => {
    expect(computeDueReminders(DEADLINE, [task(DUE_DAY)])).toEqual([
      { taskId: "t1", userId: "u1", kind: "AtDeadline", dueAtSnapshot: DUE_DAY },
    ]);
    const atEnd = new Date(DEADLINE.getTime() + 6 * HOUR);
    expect(computeDueReminders(atEnd, [task(DUE_DAY)])).toEqual([]);
  });

  it("fans out to every assignee", () => {
    const now = new Date(DEADLINE.getTime() + HOUR);
    const tuples = computeDueReminders(now, [task(DUE_DAY, ["u1", "u2", "u3"])]);
    expect(tuples.map((t) => t.userId)).toEqual(["u1", "u2", "u3"]);
  });
});

describe("runTaskDueReminders", () => {
  const NOW = new Date(DEADLINE.getTime() + HOUR); // AtDeadline window open

  function pendingRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "r1",
      taskId: "t1",
      userId: "u1",
      kind: "AtDeadline",
      dueAtSnapshot: DUE_DAY,
      sentAt: null,
      task: {
        title: "Ship it",
        dueAt: DUE_DAY,
        status: "InProgress",
        projectId: "p1",
        assignees: [{ userId: "u1" }],
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.taskReminder.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.taskReminder.findMany.mockResolvedValue([]);
    mockPrisma.taskReminder.update.mockResolvedValue({});
    // Recipient-timezone lookup for the per-recipient reminder body.
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockNotify.mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 1 });
  });

  it("claims tuples with skipDuplicates and sends pending rows", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      { id: "t1", dueAt: DUE_DAY, assignees: [{ userId: "u1" }] },
    ]);
    mockPrisma.taskReminder.findMany.mockResolvedValue([pendingRow()]);

    const result = await runTaskDueReminders({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.taskReminder.createMany).toHaveBeenCalledWith({
      data: [{ taskId: "t1", userId: "u1", kind: "AtDeadline", dueAtSnapshot: DUE_DAY }],
      skipDuplicates: true,
    });
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "task.due_reminder",
        message: expect.objectContaining({
          title: "Task due now: Ship it",
          link: "/projects/p1?tab=board&task=t1",
        }),
        recipients: [{ userId: "u1" }],
      }),
    );
    expect(mockPrisma.taskReminder.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { sentAt: NOW },
    });
    expect(result.items).toBe(1);
  });

  it("skips rows whose deadline moved (snapshot mismatch)", async () => {
    mockPrisma.taskReminder.findMany.mockResolvedValue([
      pendingRow({
        task: {
          title: "Ship it",
          dueAt: new Date("2026-07-17T00:00:00.000Z"),
          status: "InProgress",
          projectId: "p1",
          assignees: [{ userId: "u1" }],
        },
      }),
    ]);
    const result = await runTaskDueReminders({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("skips completed tasks and removed assignees", async () => {
    mockPrisma.taskReminder.findMany.mockResolvedValue([
      pendingRow({
        task: {
          title: "Done already",
          dueAt: DUE_DAY,
          status: "Done",
          projectId: "p1",
          assignees: [{ userId: "u1" }],
        },
      }),
      pendingRow({
        id: "r2",
        userId: "u-gone",
        task: {
          title: "Reassigned",
          dueAt: DUE_DAY,
          status: "Todo",
          projectId: "p1",
          assignees: [{ userId: "someone-else" }],
        },
      }),
    ]);
    const result = await runTaskDueReminders({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("leaves sentAt null when notify() fails, so the next tick retries", async () => {
    mockPrisma.taskReminder.findMany.mockResolvedValue([pendingRow()]);
    mockNotify.mockRejectedValue(new Error("slack down"));
    const result = await runTaskDueReminders({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockPrisma.taskReminder.update).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });
});
