// Partner CRM notification fan-out. No PartnerApplication has an owner
// (specs/partner-crm.md §3 drops `assignedMeeterId`), so "notify about this
// partner card" means "notify every active Core member" — there's no single
// recipient to resolve. This wraps notify() so jobs and (later) routes don't
// each re-derive the Core roster.
//
// The Core roster query mirrors `computeIsCore` in ~/lib/roles (env admins ∪
// AdminMembership ∪ CoreAssignment for the active cycle's terms) via that
// file's own exported helpers, rather than adding a new bulk export there —
// this change is scoped to the partners/jobs layer only.

import { prisma } from "~/lib/db";
import { notify, type NotifyResult } from "~/lib/notify.server";
import { getActiveCoreCycleTermIds, getAdminUserIdsFromEnv } from "~/lib/roles";
import type { EventType } from "~/lib/notification-events";

/** Every active Core member's userId (env admins, AdminMembership, and the active cycle's CoreAssignment rows), deduped. */
export async function partnerNotifyRecipients(): Promise<string[]> {
  const envIds = getAdminUserIdsFromEnv();
  const cycleTermIds = await getActiveCoreCycleTermIds();
  const [admins, coreAssignments] = await Promise.all([
    prisma.adminMembership.findMany({ select: { userId: true } }),
    cycleTermIds.length > 0
      ? prisma.coreAssignment.findMany({
          where: { termId: { in: cycleTermIds } },
          select: { userId: true },
        })
      : Promise.resolve([] as { userId: string }[]),
  ]);
  return [
    ...new Set([
      ...envIds,
      ...admins.map((a) => a.userId),
      ...coreAssignments.map((a) => a.userId),
    ]),
  ];
}

export async function notifyPartners(args: {
  eventType: EventType;
  title: string;
  body?: string | null;
  link?: string | null;
  dedupKey?: string | null;
  createdByUserId?: string | null;
}): Promise<NotifyResult> {
  const userIds = await partnerNotifyRecipients();
  if (userIds.length === 0) return { inApp: 0, emailed: 0, slackDmed: 0 };
  return notify({
    eventType: args.eventType,
    createdByUserId: args.createdByUserId ?? null,
    message: {
      title: args.title,
      body: args.body ?? null,
      link: args.link ?? null,
      dedupKey: args.dedupKey ?? null,
    },
    recipients: userIds.map((userId) => ({ userId })),
  });
}
