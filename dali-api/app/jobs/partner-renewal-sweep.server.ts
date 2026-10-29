// Partner renewal sweep: when a still-active ProjectPartner link's project is
// in its last planned term and that term ends within 30 days with no decision
// for the next term, remind Core to decide in Renewals.
//
// "Project's current term" = the project's own latest planned term (max
// Term.sortKey among its ProjectTerm rows), not the lab's wall-clock current
// term.

import { prisma } from "~/lib/db";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
import type { JobContext, JobResult } from "~/jobs/registry";

const CAP = 200;
const RENEWAL_WINDOW_MS = 30 * 24 * 3_600_000;

export async function runPartnerRenewalSweep({ now }: JobContext): Promise<JobResult> {
  const horizon = new Date(now.getTime() + RENEWAL_WINDOW_MS);

  const links = await prisma.projectPartner.findMany({
    where: { endedAt: null },
    select: {
      id: true,
      partnerOrgId: true,
      project: {
        select: {
          id: true,
          name: true,
          projectTerms: {
            select: { term: { select: { id: true, sortKey: true, endDate: true } } },
          },
        },
      },
    },
    take: CAP,
  });

  let reminded = 0;
  for (const link of links) {
    const terms = link.project.projectTerms.map((pt) => pt.term);
    if (terms.length === 0) continue;
    const currentTerm = terms.reduce((latest, t) => (t.sortKey > latest.sortKey ? t : latest));
    if (currentTerm.endDate < now || currentTerm.endDate > horizon) continue;

    const following = await prisma.term.findFirst({
      where: { sortKey: { gt: currentTerm.sortKey } },
      orderBy: { sortKey: "asc" },
      select: { id: true },
    });
    if (following) {
      const decided = await prisma.projectTermStatus.findFirst({
        where: { projectId: link.project.id, termId: following.id },
        select: { id: true },
      });
      if (decided) continue;
    }
    const planningOrg = await prisma.partnerOrg.findUnique({
      where: { id: link.partnerOrgId },
      select: { name: true },
    });
    if (!planningOrg) continue;
    const ends = currentTerm.endDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    await notifyPartners({
      eventType: "partner.renewal_due",
      title: `Renewal decision due: ${link.project.name}`,
      body: `${planningOrg.name}'s project ends ${ends}. Decide in Renewals.`,
      link: "/core/partners/renewals",
      dedupKey: `partner-renewal:${link.id}:${currentTerm.id}`,
    });
    reminded += 1;
  }

  return { items: reminded };
}
