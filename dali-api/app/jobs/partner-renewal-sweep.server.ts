// Partner renewal sweep: when a still-active ProjectPartner link's project is
// in its last planned term and that term ends within 30 days, auto-create a
// renewal application — unless the org already has one open.
//
// "Project's current term" = the project's own latest planned term (max
// Term.sortKey among its ProjectTerm rows), not the lab's wall-clock current
// term — a project can run ahead of or behind the lab's term cursor, and it's
// the project's own schedule that determines when its partnership is up for
// renewal.
//
// Idempotent without a ledger: the renewal application this job creates is
// itself in an open stage, so the next tick's "no open application for the
// org" check finds it and skips re-creating one.

import { prisma } from "~/lib/db";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
import { OPEN_STAGES } from "~/partners/lib/partner-application";
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

  let created = 0;
  for (const link of links) {
    const terms = link.project.projectTerms.map((pt) => pt.term);
    if (terms.length === 0) continue;
    const currentTerm = terms.reduce((latest, t) => (t.sortKey > latest.sortKey ? t : latest));
    if (currentTerm.endDate < now || currentTerm.endDate > horizon) continue;

    const existingOpen = await prisma.partnerApplication.findFirst({
      where: { partnerOrgId: link.partnerOrgId, stage: { in: [...OPEN_STAGES] } },
      select: { id: true },
    });
    if (existingOpen) continue;

    const org = await prisma.partnerOrg.findUnique({
      where: { id: link.partnerOrgId },
      select: { name: true, primaryContactId: true },
    });
    if (!org) continue;

    // `primaryContactId` is really a PartnerMembership.id (see schema
    // comment) — resolve it to that membership's contactId, falling back to
    // the org's earliest membership. Skip the org entirely if it has none.
    let contactId: string | null = null;
    if (org.primaryContactId) {
      const primary = await prisma.partnerMembership.findUnique({
        where: { id: org.primaryContactId },
        select: { contactId: true },
      });
      contactId = primary?.contactId ?? null;
    }
    if (!contactId) {
      const earliest = await prisma.partnerMembership.findFirst({
        where: { orgId: link.partnerOrgId },
        orderBy: { createdAt: "asc" },
        select: { contactId: true },
      });
      contactId = earliest?.contactId ?? null;
    }
    if (!contactId) continue;

    const application = await prisma.partnerApplication.create({
      data: {
        applicantContactId: contactId,
        partnerOrgId: link.partnerOrgId,
        source: "Renewal",
        stage: "New",
        title: `Renew: ${link.project.name}`,
      },
      select: { id: true },
    });

    await logPartnerActivity(prisma, {
      applicationId: application.id,
      type: "Created",
      metadata: { renewalOfProjectId: link.project.id },
    });

    await notifyPartners({
      eventType: "partner.renewal_due",
      title: `Renewal created: ${link.project.name}`,
      body: `${org.name}'s project is ending soon.`,
      link: `/core/partners?application=${application.id}`,
      dedupKey: `partner-renewal:${link.id}:${currentTerm.id}`,
    });
    created += 1;
  }

  return { items: created };
}
