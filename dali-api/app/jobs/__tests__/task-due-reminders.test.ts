import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
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
const NOW = new Date("2026-07-15T12:00:00Z");

function task(dueAt: Date, assigneeIds = ["u1"]) {
  return { id: "t1", dueAt, assigneeIds };
}

describe("computeDueReminders", () => {
  it("fires DayBefore inside [dueAt-24h, dueAt-24h+6h)", () => {
    // Window opened 1h ago.
    const dueAt = new Date(NOW.getTime() + 23 * HOUR);
    expect(computeDueReminders(NOW, [task(dueAt)])).toEqual([
      { taskId: "t1", userId: "u1", kind: "DayBefore", dueAtSnapshot: dueAt },
    ]);
  });

  it("does not fire DayBefore before the window opens", () => {
    const dueAt = new Date(NOW.getTime() + 25 * HOUR);
    expect(computeDueReminders(NOW, [task(dueAt)])).toEqual([]);
  });

  it("expires DayBefore after the 6h catch-up bound", () => {
    // Window opened 7h ago (due in 17h).
    const dueAt = new Date(NOW.getTime() + 17 * HOUR);
    expect(computeDueReminders(NOW, [task(dueAt)])).toEqual([]);
  });

  it("fires AtDeadline inside [dueAt, dueAt+6h) but not before", () => {
    const justDue = new Date(NOW.getTime() - 1 * HOUR);
    expect(computeDueReminders(NOW, [task(justDue)])).toEqual([
      { taskId: "t1", userId: "u1", kind: "AtDeadline", dueAtSnapshot: justDue },
    ]);

    const notYet = new Date(NOW.getTime() + 1 * HOUR);
    expect(
      computeDueReminders(NOW, [task(notYet)]).filter((t) => t.kind === "AtDeadline"),
    ).toEqual([]);

    const longPast = new Date(NOW.getTime() - 7 * HOUR);
    expect(computeDueReminders(NOW, [task(longPast)])).toEqual([]);
  });

  it("boundary: exactly at dueAt fires AtDeadline, exactly at window end does not", () => {
    expect(computeDueReminders(NOW, [task(NOW)])).toEqual([
      { taskId: "t1", userId: "u1", kind: "AtDeadline", dueAtSnapshot: NOW },
    ]);
    const atEnd = new Date(NOW.getTime() - 6 * HOUR);
    expect(computeDueReminders(NOW, [task(atEnd)])).toEqual([]);
  });

  it("fans out to every assignee", () => {
    const dueAt = new Date(NOW.getTime() - HOUR);
    const tuples = computeDueReminders(NOW, [task(dueAt, ["u1", "u2", "u3"])]);
    expect(tuples.map((t) => t.userId)).toEqual(["u1", "u2", "u3"]);
  });
});

describe("runTaskDueReminders", () => {
  const DUE = new Date(NOW.getTime() - HOUR); // AtDeadline window open

  function pendingRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "r1",
      taskId: "t1",
      userId: "u1",
      kind: "AtDeadline",
      dueAtSnapshot: DUE,
      sentAt: null,
      task: {
        title: "Ship it",
        dueAt: DUE,
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
    mockNotify.mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 1 });
  });

  it("claims tuples with skipDuplicates and sends pending rows", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      { id: "t1", dueAt: DUE, assignees: [{ userId: "u1" }] },
    ]);
    mockPrisma.taskReminder.findMany.mockResolvedValue([pendingRow()]);

    const result = await runTaskDueReminders({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.taskReminder.createMany).toHaveBeenCalledWith({
      data: [{ taskId: "t1", userId: "u1", kind: "AtDeadline", dueAtSnapshot: DUE }],
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
          dueAt: new Date(DUE.getTime() + 2 * HOUR),
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
          dueAt: DUE,
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
          dueAt: DUE,
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
