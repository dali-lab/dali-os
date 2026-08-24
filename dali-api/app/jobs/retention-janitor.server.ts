// Retention sweep for the ledgers the notification layer grows without
// bound: read Notification rows, TaskReminder rows, and MeetingReminderLog
// rows past the retention window. Unread notifications are never touched —
// only rows the recipient has seen (or reminder bookkeeping) age out.
//
// Deleting old ledger rows can't resurrect reminders: both reminder jobs
// only look at a window around `now`, far inside any whole-month cutoff.

import { prisma } from "~/lib/db";
import { Prisma } from "~/generated/prisma/client";
import type { JobContext, JobResult } from "~/jobs/registry";

// Strip the heavy rendered payload off Sent outbound rows this soon after
// delivery — the lightweight metadata row lives on for the audit trail.
const OUTBOUND_PAYLOAD_STRIP_HOURS = 24;

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

  // Outbound queue: strip rendered bodies/attachments off delivered rows (keep
  // the metadata for the Admin → Communications history), then delete terminal
  // rows past the retention window. Dead rows are LEFT for operator attention.
  const payloadCutoff = new Date(now.getTime() - OUTBOUND_PAYLOAD_STRIP_HOURS * 3_600_000);
  const outboundStripped = await prisma.outboundMessage.updateMany({
    where: {
      status: "Sent",
      sentAt: { lt: payloadCutoff },
      OR: [{ bodyHtml: { not: null } }, { attachments: { not: Prisma.DbNull } }],
    },
    data: {
      bodyHtml: null,
      bodyText: null,
      slackText: null,
      ics: null,
      attachments: Prisma.DbNull,
    },
  });
  const outboundDeleted = await prisma.outboundMessage.deleteMany({
    where: { status: { in: ["Sent", "Canceled"] }, createdAt: { lt: cutoff } },
  });

  return {
    items: notifications.count + taskReminders.count + meetingLogs.count + outboundDeleted.count,
    note:
      `notifications=${notifications.count} taskReminders=${taskReminders.count} ` +
      `meetingLogs=${meetingLogs.count} outboundStripped=${outboundStripped.count} ` +
      `outboundDeleted=${outboundDeleted.count}`,
  };
}
