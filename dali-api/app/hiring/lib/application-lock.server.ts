import { prisma } from "~/lib/db.server";
import { isDomainClosed } from "./domain-windows";

type DomainWindowRow = { domainId: string; closeDate: Date | string | null };
type CycleWindow = { closeDate: Date | string | null };
type SelectedDa = { id: string; domainId: string };

export function closedDomainIdSet(
  domains: DomainWindowRow[],
  cycle: CycleWindow,
  now: Date = new Date(),
): Set<string> {
  return new Set(domains.filter((d) => isDomainClosed(d, cycle, now)).map((d) => d.domainId));
}

export function frozenSelection(
  closedDomainIds: Set<string>,
  selectedDas: SelectedDa[],
): { frozenDaIds: Set<string>; generalFrozen: boolean } {
  const frozenDaIds = new Set(
    selectedDas.filter((da) => closedDomainIds.has(da.domainId)).map((da) => da.id),
  );
  return { frozenDaIds, generalFrozen: frozenDaIds.size > 0 };
}

export async function closedDomainIdsForCycle(
  applicationCycleId: string,
  cycle: CycleWindow,
  now: Date = new Date(),
): Promise<Set<string>> {
  const domains = await prisma.domainApplicationCycle.findMany({
    where: { applicationCycleId, isReady: true },
    select: { domainId: true, closeDate: true },
  });
  return closedDomainIdSet(domains, cycle, now);
}

/** Per-request lock state for one applicant's application: which ready domains
 * are closed, which of their selected DomainApplications fall in one, and
 * whether that freezes the shared general application. */
export async function applicationLock(
  applicationCycleId: string,
  cycle: CycleWindow,
  selectedDas: SelectedDa[],
  now: Date = new Date(),
): Promise<{ closedDomainIds: Set<string>; frozenDaIds: Set<string>; generalFrozen: boolean }> {
  const closedDomainIds = await closedDomainIdsForCycle(applicationCycleId, cycle, now);
  return { closedDomainIds, ...frozenSelection(closedDomainIds, selectedDas) };
}
