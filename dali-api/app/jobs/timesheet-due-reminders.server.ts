// Biweekly timesheet reminder. Pay periods are the computed fortnights from
// app/lib/pay-period.ts (not PayPeriod rows, which only exist once payroll has
// closed a period), so the job needs no state beyond the runner's
// lastSuccessAt: it rides the digest wall-clock gate for "once at sendHourEt"
// and notify()'s dedupKey for "once per period".

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { currentTerm } from "~/lib/roles";
import { shouldRunDigest } from "~/lib/notification-digest.server";
import { formatDayRange, payPeriodFor } from "~/lib/pay-period";
import { getZonedParts, APPLICATION_TZ } from "~/lib/timezone";
import type { JobContext, JobResult } from "~/jobs/registry";

const DAY_MS = 86_400_000;

export const TIMESHEET_LINK = "/calendar?tab=timesheet";

export function timesheetReminderDedupKey(periodIndex: number): string {
  return `timesheet.due_reminder:${periodIndex}`;
}

// Same role set the Timesheet tab offers in its role picker
// (app/lib/roles.ts#getUserRoleInstances), queried in bulk.
export async function paidRoleUserIds(): Promise<string[]> {
  const term = await currentTerm();
  const termScoped = term
    ? await Promise.all([
        prisma.projectAssignment.findMany({
          where: { termId: term.id },
          select: { userId: true },
          distinct: ["userId"],
        }),
        prisma.coreAssignment.findMany({
          where: { termId: term.id },
          select: { userId: true },
          distinct: ["userId"],
        }),
        prisma.instructorAssignment.findMany({
          where: { termId: term.id },
          select: { userId: true },
          distinct: ["userId"],
        }),
        prisma.domainLeadAssignment.findMany({
          where: { termId: term.id },
          select: { userId: true },
          distinct: ["userId"],
        }),
      ])
    : [];
  const customHires = await prisma.customHire.findMany({
    where: { archivedAt: null },
    select: { userId: true },
    distinct: ["userId"],
  });
  const ids = new Set<string>();
  for (const rows of [...termScoped, customHires]) {
    for (const row of rows) ids.add(row.userId);
  }
  if (ids.size === 0) return [];
  // A role row can outlive graduation (a custom hire nobody archived).
  const alumni = await prisma.user.findMany({
    where: { id: { in: [...ids] }, membershipStatus: "Alumni" },
    select: { id: true },
  });
  for (const { id } of alumni) ids.delete(id);
  return [...ids];
}

export async function runTimesheetDueReminders({
  now,
  lastSuccessAt,
  settings,
}: JobContext): Promise<JobResult> {
  const { year, month, day } = getZonedParts(now, APPLICATION_TZ);
  const todayUtc = new Date(Date.UTC(year, month - 1, day));
  const period = payPeriodFor(todayUtc);
  const reminderDay = period.end.getTime() - settings.daysBeforeEnd * DAY_MS;
  if (todayUtc.getTime() !== reminderDay) {
    return { items: 0, note: "not the reminder day" };
  }
  if (!shouldRunDigest("Daily", lastSuccessAt, now, { sendHourEt: settings.sendHourEt })) {
    return { items: 0, note: "outside send window" };
  }

  const userIds = await paidRoleUserIds();
  if (userIds.length === 0) return { items: 0, note: "no paid roles" };

  const result = await notify({
    eventType: "timesheet.due_reminder",
    message: {
      vars: { itemTitle: formatDayRange(period.start, period.end) },
      link: TIMESHEET_LINK,
      dedupKey: timesheetReminderDedupKey(period.index),
    },
    recipients: userIds.map((userId) => ({ userId })),
  });
  return { items: result.inApp };
}
