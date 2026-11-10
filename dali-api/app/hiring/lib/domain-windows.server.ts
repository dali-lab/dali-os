import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";

async function latestCycleStatus(cycleId: string): Promise<ApplicationCycleStatus> {
  const latest = await prisma.applicationCycleStatusUpdate.findFirst({
    where: { applicationCycleId: cycleId },
    orderBy: { createdAt: "desc" },
    select: { newStatus: true },
  });
  return latest?.newStatus ?? "Draft";
}

/**
 * Whether a domain's setup (membership in the cycle, challenge form, ready
 * flag) may still change. Always in Draft. After the cycle opens, only for a
 * domain not yet marked ready: applicants see ready domains only, so a staged
 * domain is still invisible and safe to edit. Never once review has started.
 */
export async function canEditDomainSetup(cycleId: string, domainId: string): Promise<boolean> {
  const status = await latestCycleStatus(cycleId);
  if (status === "Draft") return true;
  if (status !== "Open") return false;
  const dac = await prisma.domainApplicationCycle.findUnique({
    where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
    select: { isReady: true },
  });
  return dac !== null && !dac.isReady;
}

/**
 * What stops a domain going live in an already-Open cycle. Mirrors the
 * per-domain half of the Draft→Open readiness check in
 * api.cycles.$cycleId.status.ts, which a domain added later never ran through.
 * Null when the domain can be marked ready.
 */
export async function domainGoLiveProblem(cycleId: string, domainId: string): Promise<string | null> {
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    select: { hasChallenges: true },
  });
  if (!cycle) return "Cycle not found";
  if (cycle.hasChallenges) {
    const linked = await prisma.cycleDomainForm.count({ where: { applicationCycleId: cycleId, domainId } });
    if (linked === 0) return "Link a challenge form before this domain opens to applicants";
  }
  return null;
}

/**
 * Flip a domain's ready flag. In Draft this is free. In an Open cycle, marking
 * ready is what publishes a staged domain to applicants, so it runs the
 * go-live check first, and unmarking is refused because applicants may already
 * have picked the domain. Returns the refusal reason, or null on success.
 */
export async function setDomainReady(
  cycleId: string,
  domainId: string,
  isReady: boolean,
  audit?: { actorId: string; request: Request; forced?: boolean },
): Promise<string | null> {
  const status = await latestCycleStatus(cycleId);
  if (status === "Open") {
    if (!isReady) return "A domain can't be unmarked ready while the cycle is open";
    const problem = await domainGoLiveProblem(cycleId, domainId);
    if (problem) return problem;
  } else if (status !== "Draft") {
    return "Domains can only change while the cycle is in Draft or Open";
  }
  await prisma.domainApplicationCycle.upsert({
    where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
    update: { isReady },
    create: { domainId, applicationCycleId: cycleId, isReady },
  });
  if (audit) {
    await logAuditEvent({
      action: "domain.ready.set",
      userId: audit.actorId,
      targetId: domainId,
      metadata: { cycleId, ready: isReady, ...(audit.forced ? { forced: true } : {}) },
      request: audit.request,
    });
  }
  return null;
}
