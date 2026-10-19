// Post-project survey send (specs/partner-crm.md §11): once a ProjectPartner's
// endedAt is set, email the org's contact a link to the bound survey form —
// once. Idempotent via surveySentAt: the query below excludes rows that
// already have it set, so a crash-and-retry (or a slow run overlapping the
// next tick) can't double-send.

import { prisma } from "~/lib/db";
import { sendPartnerSurvey } from "~/partners/lib/partner-survey.server";
import type { JobContext, JobResult } from "~/jobs/registry";

const CAP = 200;
const LOOKBACK_DAYS = 30;

export async function runPartnerSurveySend({ now }: JobContext): Promise<JobResult> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.projectPartner.findMany({
    where: {
      endedAt: { not: null, gte: since, lte: now },
      surveySentAt: null,
    },
    select: { id: true },
    take: CAP,
  });

  let sent = 0;
  for (const link of candidates) {
    const result = await sendPartnerSurvey({ projectPartnerId: link.id });
    if (result.ok) sent += 1;
  }

  return { items: sent };
}
