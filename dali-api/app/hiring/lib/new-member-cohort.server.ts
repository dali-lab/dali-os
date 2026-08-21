// "New member" cohort for signing audiences. A member is new when they were
// accepted (a Released Accepted decision) in the most recent General (Standard)
// hiring cycle OR the most recent Fellowship cycle — i.e. the incoming cohort.
//
// We anchor on the most recent cycle *of each type that actually produced a
// hire* (not merely the newest cycle), so a freshly-opened, not-yet-decided
// cycle doesn't blank the cohort mid-term. Callers intersect this with the
// active-member set (see app/signing/lib/audiences.ts).

import { prisma } from "~/lib/db";

const NEW_MEMBER_CYCLE_TYPES = ["Standard", "Fellowship"] as const;

// A DomainApplication that reached an accepted outcome the applicant still holds.
const ACCEPTED_DOMAIN_APP = {
  selected: true,
  decisions: { some: { stage: "Released", type: "Accepted" } },
} as const;

async function latestCycleIdsWithAccepts(): Promise<string[]> {
  const cycles = await Promise.all(
    NEW_MEMBER_CYCLE_TYPES.map((cycleType) =>
      prisma.applicationCycle.findFirst({
        where: {
          cycleType,
          applications: { some: { domainApplications: { some: ACCEPTED_DOMAIN_APP } } },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      }),
    ),
  );
  return cycles.filter((c): c is { id: string } => c !== null).map((c) => c.id);
}

// The set of userIds accepted in the current incoming cohort. Empty when no
// General/Fellowship cycle has produced a hire yet.
export async function getNewMemberCohortIds(): Promise<Set<string>> {
  const cycleIds = await latestCycleIdsWithAccepts();
  if (cycleIds.length === 0) return new Set();
  const apps = await prisma.application.findMany({
    where: {
      applicationCycleId: { in: cycleIds },
      domainApplications: { some: ACCEPTED_DOMAIN_APP },
    },
    select: { userId: true },
  });
  return new Set(apps.map((a) => a.userId));
}

// Single-user gate: is this user part of the current incoming cohort?
export async function isNewMemberCohort(userId: string): Promise<boolean> {
  const cycleIds = await latestCycleIdsWithAccepts();
  if (cycleIds.length === 0) return false;
  const app = await prisma.application.findFirst({
    where: {
      userId,
      applicationCycleId: { in: cycleIds },
      domainApplications: { some: ACCEPTED_DOMAIN_APP },
    },
    select: { id: true },
  });
  return app !== null;
}
