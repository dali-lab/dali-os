// Task deadline reminders: assignees hear a day before and at the moment a
// task is due (channels per their notification preferences; the registry
// defaults task.due_reminder to in-app + Slack DM).
//
// Two-phase, both idempotent:
//   claim — compute (task, user, kind, dueAtSnapshot) tuples whose window
//     contains `now` and createMany(skipDuplicates) into TaskReminder;
//     re-enqueueing an unchanged deadline is a no-op, a moved deadline
//     makes a fresh row and strands the old one (inert).
//   send — pick up unsent rows whose snapshot still matches the live task,
//     notify(), stamp sentAt. Crash between claim and send just means the
//     next tick re-picks the unsent row.
//
// Windows are catch-up style ([start, start+6h)): a machine gap can't
// permanently skip a reminder, and the copy is computed from the real dueAt
// so a late send still reads correctly.

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { APPLICATION_TZ, formatInstantWithZoneLabel, resolveUserTimeZone } from "~/lib/timezone";
import type { JobContext, JobResult } from "~/jobs/registry";
import type { ReminderKind } from "~/generated/prisma/client";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// Catch-up bound: how long after its window opens a reminder may still fire.
const WINDOW_MS = 6 * HOUR_MS;
// Backpressure: max rows claimed/sent per tick (5-min interval → plenty).
const CAP = 200;

const OPEN_STATUSES = ["Todo", "InProgress", "InReview"] as const;

export type DueTuple = {
  taskId: string;
  userId: string;
  kind: ReminderKind;
  dueAtSnapshot: Date;
};

function windowContains(kind: ReminderKind, now: Date, dueAt: Date): boolean {
  const start = kind === "DayBefore" ? dueAt.getTime() - DAY_MS : dueAt.getTime();
  return now.getTime() >= start && now.getTime() < start + WINDOW_MS;
}

export function computeDueReminders(
  now: Date,
  tasks: { id: string; dueAt: Date; assigneeIds: string[] }[],
): DueTuple[] {
  const tuples: DueTuple[] = [];
  for (const task of tasks) {
    for (const kind of ["DayBefore", "AtDeadline"] as const) {
      if (!windowContains(kind, now, task.dueAt)) continue;
      for (const userId of task.assigneeIds) {
        tuples.push({ taskId: task.id, userId, kind, dueAtSnapshot: task.dueAt });
      }
    }
  }
  return tuples;
}

export async function runTaskDueReminders({ now }: JobContext): Promise<JobResult> {
  // Claim. The dueAt bound keeps the scan tiny: 30h back covers a DayBefore
  // window that opened up to 6h ago; 25h forward covers one opening now.
  const tasks = await prisma.task.findMany({
    where: {
      dueAt: {
        gte: new Date(now.getTime() - 30 * HOUR_MS),
        lte: new Date(now.getTime() + 25 * HOUR_MS),
      },
      status: { in: [...OPEN_STATUSES] },
    },
    select: { id: true, dueAt: true, assignees: { select: { userId: true } } },
  });
  const tuples = computeDueReminders(
    now,
    tasks.map((t) => ({
      id: t.id,
      dueAt: t.dueAt!,
      assigneeIds: t.assignees.map((a) => a.userId),
    })),
  ).slice(0, CAP);
  if (tuples.length > 0) {
    await prisma.taskReminder.createMany({ data: tuples, skipDuplicates: true });
  }

  // Send. The dueAtSnapshot bound ages inert rows (moved deadlines) out of
  // the scan — that's what the [sentAt, dueAtSnapshot] index is for.
  const pending = await prisma.taskReminder.findMany({
    where: {
      sentAt: null,
      dueAtSnapshot: {
        gte: new Date(now.getTime() - 30 * HOUR_MS),
        lte: new Date(now.getTime() + 25 * HOUR_MS),
      },
    },
    include: {
      task: {
        select: {
          title: true,
          dueAt: true,
          status: true,
          projectId: true,
          assignees: { select: { userId: true } },
        },
      },
    },
    take: CAP,
  });

  // Resolve each recipient's display zone once so "Due …" reads in their own
  // local time (with a zone label), not a hardcoded ET.
  const tzRows = await prisma.user.findMany({
    where: { id: { in: Array.from(new Set(pending.map((p) => p.userId))) } },
    select: { id: true, timeZone: true },
  });
  const tzByUser = new Map(tzRows.map((r) => [r.id, resolveUserTimeZone(r)]));

  let sent = 0;
  for (const reminder of pending) {
    const task = reminder.task;
    const stillValid =
      task.dueAt !== null &&
      task.dueAt.getTime() === reminder.dueAtSnapshot.getTime() &&
      (OPEN_STATUSES as readonly string[]).includes(task.status) &&
      task.assignees.some((a) => a.userId === reminder.userId) &&
      windowContains(reminder.kind, now, task.dueAt);
    if (!stillValid) continue; // inert (moved/closed/unassigned) — never sends

    const when = formatInstantWithZoneLabel(
      task.dueAt!,
      tzByUser.get(reminder.userId) ?? APPLICATION_TZ,
    );
    try {
      await notify({
        eventType: "task.due_reminder",
        message:
          reminder.kind === "DayBefore"
            ? {
                title: `Task due tomorrow: ${task.title}`,
                body: `Due ${when}.`,
                link: `/projects/${task.projectId}?tab=board&task=${reminder.taskId}`,
                dueAt: task.dueAt,
              }
            : {
                title: `Task due now: ${task.title}`,
                body: `Due ${when}.`,
                link: `/projects/${task.projectId}?tab=board&task=${reminder.taskId}`,
                dueAt: task.dueAt,
              },
        recipients: [{ userId: reminder.userId }],
      });
      await prisma.taskReminder.update({
        where: { id: reminder.id },
        data: { sentAt: now },
      });
      sent += 1;
    } catch (err) {
      // Leave sentAt null — the next tick retries while the window is open.
      console.error(`[jobs] task reminder ${reminder.id} failed:`, err);
    }
  }

  return { items: sent };
}
