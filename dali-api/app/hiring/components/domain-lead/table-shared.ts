import type { DomainLeadData } from "~/hiring/lib/domain-lead-dashboard.server";


export const OS_TABLE_HEAD = "text-os-grey text-xs";

export const OS_TABLE_ROW = "border-t border-os-container hover:bg-os-card-hover transition-colors";

export type DomainLeadEntry = DomainLeadData["domainData"][number];
export type DomainApp = DomainLeadEntry["apps"][number];
export type DomainAppReview = NonNullable<DomainApp["domainApplications"][number]["reviews"]>[number];
export type DraftDecision = DomainLeadEntry["draftDecisions"][number];
export type CycleReviewerRow = DomainLeadEntry["cycleReviewersForDomain"][number];
export type RubricCriterionRow = DomainLeadEntry["rubricCriteria"][number];
export type DomainCycle = NonNullable<DomainLeadEntry["cycle"]>;
export type LinkedChallengeForm = DomainLeadEntry["linkedChallengeForms"][number];
export type RubricOption = DomainLeadEntry["rubricVersionOptions"][number];
export type DelibsSession = DomainLeadEntry["delibsSessions"][number];
export type DomainInterview = DomainLeadEntry["interviews"][number];
export type DomainInterviewer = DomainLeadEntry["interviewers"][number];

type Named = { firstName?: string | null; lastName?: string | null; daliEmail?: string | null } | null | undefined;

export function personName(u: Named): string | undefined {
  return (u?.firstName && u?.lastName ? `${u.firstName} ${u.lastName}` : u?.daliEmail) ?? undefined;
}
