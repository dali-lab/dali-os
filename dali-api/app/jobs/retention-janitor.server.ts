// Retention sweep for the ledgers the notification layer grows without
// bound: read Notification rows, TaskReminder rows, and MeetingReminderLog
// rows past the retention window. Unread notifications are never touched —
// only rows the recipient has seen (or reminder bookkeeping) age out.
//
// Deleting old ledger rows can't resurrect reminders: both reminder jobs
// only look at a window around `now`, far inside any whole-month cutoff.

import { prisma } from "~/lib/db";
import type { JobContext, JobResult } from "~/jobs/registry";

export async function runRetentionJanitor({
  now,
  settings,
}: JobContext): Promise<JobResult> {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - settings.retentionMonths);

  const notifications = await prisma.notification.deleteMany({
    where: { readAt: { not: null }, createdAt: { lt: cutoff } },
  });
  const taskReminders = await prisma.taskReminder.deleteMany({
    where: {
      OR: [
        { sentAt: { lt: cutoff } },
        { sentAt: null, dueAtSnapshot: { lt: cutoff } },
      ],
    },
  });
  const meetingLogs = await prisma.meetingReminderLog.deleteMany({
    where: { sentAt: { lt: cutoff } },
  });

  return {
    items: notifications.count + taskReminders.count + meetingLogs.count,
    note: `notifications=${notifications.count} taskReminders=${taskReminders.count} meetingLogs=${meetingLogs.count}`,
  };
}
