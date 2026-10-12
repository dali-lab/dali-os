// Warns a lead before releasing an Accept that would, as a side effect, close
// a sibling DomainApplication whose own window (domain-windows.ts) is still
// open — the applicant may still be mid-challenge there when
// api.decisions.$id.release closes it as AcceptedElsewhere.

import { prisma } from "~/lib/db";
import { domainCloseDate, isDomainClosed } from "./domain-windows";

export interface OpenSiblingDomain {
  name: string;
  closeDate: Date | null;
}

/**
 * Still-open sibling domains that releasing this Accept would close as
 * AcceptedElsewhere: the same application's other selected DomainApplications
 * with no Released decision of their own and no closure recorded yet, whose
 * domain hasn't closed. Empty when the DA doesn't exist, has no cycle, or has
 * no such siblings.
 */
export async function openSiblingDomains(
  domainApplicationId: string,
  now: Date = new Date(),
): Promise<OpenSiblingDomain[]> {
  const domainApp = await prisma.domainApplication.findUnique({
    where: { id: domainApplicationId },
    select: {
      applicationId: true,
      application: { select: { applicationCycleId: true } },
    },
  });
  if (!domainApp) return [];

  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: domainApp.application.applicationCycleId },
    select: { closeDate: true },
  });
  if (!cycle) return [];

  const siblings = await prisma.domainApplication.findMany({
    where: {
      applicationId: domainApp.applicationId,
      id: { not: domainApplicationId },
      selected: true,
      closureReason: null,
      decisions: { none: { stage: "Released" } },
    },
    select: {
      domainId: true,
      domain: { select: { name: true, displayName: true } },
    },
  });
  if (siblings.length === 0) return [];

  const dacRows = await prisma.domainApplicationCycle.findMany({
    where: {
      applicationCycleId: domainApp.application.applicationCycleId,
      domainId: { in: siblings.map((s) => s.domainId) },
    },
    select: { domainId: true, closeDate: true },
  });
  const dacByDomainId = new Map(dacRows.map((d) => [d.domainId, d]));

  const open: OpenSiblingDomain[] = [];
  for (const s of siblings) {
    const dac = dacByDomainId.get(s.domainId) ?? { closeDate: null };
    if (isDomainClosed(dac, cycle, now)) continue;
    open.push({
      name: s.domain.displayName ?? s.domain.name,
      closeDate: domainCloseDate(dac, cycle),
    });
  }
  return open;
}
