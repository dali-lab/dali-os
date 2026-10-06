// Query layer for /core/partners/reports (specs/partner-crm.md §12). Fetches
// plain rows and hands them to the pure aggregation in partner-reports.ts —
// kept here (not in the route) only because every query needs the same term
// scoping resolved first.

import { prisma } from "~/lib/db";
import { PROJECTING_STAGES } from "./partner-application";
import {
  computeFunnel,
  computeFunnelBySource,
  computeCycleTimes,
  computeRejectionReasons,
  computePartnerMix,
  computeCapacity,
  computeRevenueByOrg,
  type FunnelResult,
  type FunnelBySourceRow,
  type CycleTimeResult,
  type RejectionReasonRow,
  type PartnerMixResult,
  type CapacityCell,
  type RevenueRow,
} from "./partner-reports";

export type TermOption = { id: string; code: string };

export type PartnerReportsTermContext = {
  terms: TermOption[];
  selectedTermId: string | null; // null = "All time"
  selectedTermCode: string | null;
};

/**
 * Resolve the term picker: `termParam` of "all" (or an unknown id) means "All
 * time"; otherwise the given term if it exists, else the lab's current term,
 * else "All time" (no terms seeded).
 */
export async function resolveReportsTerm(termParam: string | null): Promise<PartnerReportsTermContext> {
  const terms = await prisma.term.findMany({
    orderBy: { sortKey: "desc" },
    select: { id: true, code: true },
  });

  if (termParam === "all") {
    return { terms, selectedTermId: null, selectedTermCode: null };
  }
  if (termParam && terms.some((t) => t.id === termParam)) {
    const term = terms.find((t) => t.id === termParam)!;
    return { terms, selectedTermId: term.id, selectedTermCode: term.code };
  }

  const now = new Date();
  const current =
    (await prisma.term.findFirst({
      where: { startDate: { lte: now }, endDate: { gte: now } },
      orderBy: { sortKey: "desc" },
      select: { id: true, code: true },
    })) ??
    (await prisma.term.findFirst({
      where: { startDate: { gt: now } },
      orderBy: { sortKey: "asc" },
      select: { id: true, code: true },
    }));

  return current
    ? { terms, selectedTermId: current.id, selectedTermCode: current.code }
    : { terms, selectedTermId: null, selectedTermCode: null };
}

async function termWindow(termId: string | null): Promise<{ start: Date; end: Date } | null> {
  if (!termId) return null;
  const term = await prisma.term.findUnique({
    where: { id: termId },
    select: { startDate: true, endDate: true },
  });
  return term ? { start: term.startDate, end: term.endDate } : null;
}

export async function loadFunnelSection(
  termId: string | null,
): Promise<{ funnel: FunnelResult; bySource: FunnelBySourceRow[] }> {
  const apps = await prisma.partnerApplication.findMany({
    where: termId ? { targetTerms: { some: { termId } } } : undefined,
    select: { id: true, stage: true, source: true },
  });
  const appIds = apps.map((a) => a.id);
  const statusChanges =
    appIds.length > 0
      ? await prisma.partnerActivity.findMany({
          where: { applicationId: { in: appIds }, type: "StatusChanged" },
          select: { applicationId: true, metadata: true },
        })
      : [];
  const changes = statusChanges
    .map((r) => ({ applicationId: r.applicationId!, to: (r.metadata as { to?: string } | null)?.to }))
    .filter((r): r is { applicationId: string; to: "New" | "Interview" | "Accepted" | "Rejected" } =>
      r.to === "New" || r.to === "Interview" || r.to === "Accepted" || r.to === "Rejected",
    );

  return {
    funnel: computeFunnel(apps, changes),
    bySource: computeFunnelBySource(apps),
  };
}

export async function loadCycleTimeSection(termId: string | null): Promise<CycleTimeResult> {
  const apps = await prisma.partnerApplication.findMany({
    where: termId ? { targetTerms: { some: { termId } } } : undefined,
    select: { id: true },
  });
  const appIds = apps.map((a) => a.id);
  if (appIds.length === 0) {
    return { medianToAcceptedDays: null, medianToProjectDays: null, sampleSize: { toAccepted: 0, toProject: 0 } };
  }
  const activities = await prisma.partnerActivity.findMany({
    where: { applicationId: { in: appIds }, type: { in: ["Created", "StatusChanged"] } },
    select: { applicationId: true, type: true, createdAt: true, metadata: true },
  });
  return computeCycleTimes(activities);
}

export async function loadRejectionReasonsSection(termId: string | null): Promise<RejectionReasonRow[]> {
  const apps = await prisma.partnerApplication.findMany({
    where: {
      stage: "Rejected",
      ...(termId ? { targetTerms: { some: { termId } } } : {}),
    },
    select: { rejectReason: true },
  });
  return computeRejectionReasons(apps);
}

export async function loadPartnerMixSection(termId: string | null): Promise<PartnerMixResult> {
  const window = await termWindow(termId);

  // Orgs partnering on a project that runs in the selected term (or, for "all
  // time", every org that has ever had a ProjectPartner link at all).
  const orgsInScope = await prisma.partnerOrg.findMany({
    where: {
      projects: window ? { some: { project: { projectTerms: { some: { termId: termId! } } } } } : { some: {} },
    },
    select: {
      id: true,
      name: true,
      projects: { select: { startedAt: true } },
    },
  });

  return computePartnerMix(
    orgsInScope.map((o) => ({ orgId: o.id, orgName: o.name, links: o.projects })),
    window?.start ?? null,
  );
}

export async function loadCapacitySection(termId: string | null): Promise<CapacityCell[]> {
  if (!termId) return [];

  const [expectedRows, staffedRows] = await Promise.all([
    prisma.partnerApplicationDomain.findMany({
      where: {
        application: {
          stage: { in: PROJECTING_STAGES },
          resultingProjectId: null,
          targetTerms: { some: { termId } },
        },
      },
      select: {
        domainId: true,
        expectedMembers: true,
        domain: { select: { displayName: true } },
      },
    }),
    prisma.projectAssignment.findMany({
      where: { termId },
      select: { domainId: true, domain: { select: { displayName: true } } },
    }),
  ]);

  return computeCapacity(
    expectedRows.map((r) => ({ domainId: r.domainId, domainName: r.domain.displayName, expectedMembers: r.expectedMembers })),
    staffedRows.map((r) => ({ domainId: r.domainId, domainName: r.domain.displayName })),
  );
}

export async function loadRevenueSection(termId: string | null): Promise<RevenueRow[]> {
  const window = await termWindow(termId);
  const invoices = await prisma.partnerInvoice.findMany({
    where: {
      status: { in: ["Paid", "Issued"] },
      ...(window ? { issuedAt: { gte: window.start, lte: window.end } } : {}),
    },
    select: {
      orgId: true,
      amountCents: true,
      status: true,
      org: { select: { name: true } },
    },
  });
  return computeRevenueByOrg(
    invoices.map((i) => ({ orgId: i.orgId, orgName: i.org.name, amountCents: i.amountCents, status: i.status })),
  );
}
