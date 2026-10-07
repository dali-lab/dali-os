// Partner stale sweep: nags Core about an open partner card that has gone
// quiet past the configured threshold (PartnerCrmSettings.staleDays, default
// 14). dedupKey includes the ISO week so a card nags at most once a week, not
// once a tick.
//
// Idempotent via notify()'s dedupKey — no claim/send ledger needed.

import { prisma } from "~/lib/db";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
import { OPEN_STAGES, isStale } from "~/partners/lib/partner-application";
import type { JobContext, JobResult } from "~/jobs/registry";

const CAP = 200;
const DEFAULT_STALE_DAYS = 14;

// Standard ISO 8601 week string ("2026-W41"), UTC. The week boundary only
// needs to be stable from one tick to the next — it doesn't need to agree
// with any particular display timezone.
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3_600_000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export async function runPartnerStaleSweep({ now }: JobContext): Promise<JobResult> {
  const settings = await prisma.partnerCrmSettings.findUnique({ where: { id: "default" } });
  const staleDays = settings?.staleDays ?? DEFAULT_STALE_DAYS;

  const candidates = await prisma.partnerApplication.findMany({
    where: {
      stage: { in: [...OPEN_STAGES] },
      OR: [{ holdUntil: null }, { holdUntil: { lte: now } }],
    },
    select: { id: true, title: true, stage: true, lastActivityAt: true, holdUntil: true },
    orderBy: { lastActivityAt: "asc" },
    take: CAP,
  });

  const week = isoWeekKey(now);
  let notified = 0;
  for (const app of candidates) {
    if (!isStale(app, staleDays, now)) continue;
    const res = await notifyPartners({
      eventType: "partner.stale",
      title: `"${app.title}" has gone quiet`,
      body: `No activity in ${staleDays}+ days.`,
      link: `/core/partners?application=${app.id}`,
      dedupKey: `partner-stale:${app.id}:${week}`,
    });
    if (res.inApp > 0) notified += 1;
  }

  return { items: notified };
}
