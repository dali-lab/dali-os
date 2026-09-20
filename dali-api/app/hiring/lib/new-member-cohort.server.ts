// "New member" cohort for signing audiences. A member is new when they were
// accepted (a Released Accepted decision) in the current Students or Interns
// cohort: per group, the most recent cycle that produced a hire, plus any other
// still-active cycle of that group that has (several cycles can overlap).
//
// We anchor on cycles that actually produced a hire (not merely the newest
// cycle), so a freshly-opened, not-yet-decided cycle doesn't blank the cohort
// mid-term. Callers intersect this with the active-member set (see
// app/signing/lib/audiences.ts).

import { prisma } from "~/lib/db";
import type { CycleApplicants } from "~/generated/prisma/enums";
import { getActiveCycles } from "./cycles";

// Lab members cycles promote existing members into Core, so they add no one new.
const NEW_MEMBER_GROUPS: CycleApplicants[] = ["Students", "Interns"];

// A DomainApplication that reached an accepted outcome the applicant still holds.
const ACCEPTED_DOMAIN_APP = {
  selected: true,
  decisions: { some: { stage: "Released", type: "Accepted" } },
} as const;

async function latestCycleIdsWithAccepts(): Promise<string[]> {
  const withAccepts = {
    applications: { some: { domainApplications: { some: ACCEPTED_DOMAIN_APP } } },
  };
  const [latest, active] = await Promise.all([
    Promise.all(
      NEW_MEMBER_GROUPS.map((applicants) =>
        prisma.applicationCycle.findFirst({
          where: { applicants, ...withAccepts },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        }),
      ),
    ),
    getActiveCycles(),
  ]);
  const activeIds = active
    .filter((c) => NEW_MEMBER_GROUPS.includes(c.applicants))
    .map((c) => c.id);
  const activeWithAccepts = activeIds.length
    ? await prisma.applicationCycle.findMany({
        where: { id: { in: activeIds }, ...withAccepts },
        select: { id: true },
      })
    : [];
  return [
    ...new Set([
      ...latest.filter((c): c is { id: string } => c !== null).map((c) => c.id),
      ...activeWithAccepts.map((c) => c.id),
    ]),
  ];
}

// The set of userIds accepted in the current incoming cohort. Empty when no
// Students/Interns cycle has produced a hire yet.
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
