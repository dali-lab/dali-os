const RELATION_LABELS: Record<string, string> = {
  applicationCycles: "application cycles",
  domainLeadAssignments: "domain lead assignments",
  cycleReviewers: "cycle reviewers",
  cycleInterviewers: "cycle interviewers",
  delibsSessions: "delibs sessions",
  eligibilities: "member eligibilities",
  projectAssignments: "project assignments",
  projects: "project domains",
  projectScopes: "project scopes",
  projectRoleRequests: "project role requests",
  partnerApplicationDomains: "partner applications",
  tasks: "tasks",
  mentorshipPairs: "mentorship pairs",
};

export type DomainUsageCounts = {
  applicationCycles: number;
  domainLeadAssignments: number;
  cycleReviewers: number;
  cycleInterviewers: number;
  delibsSessions: number;
  eligibilities: number;
  projectAssignments: number;
  projects: number;
  projectScopes: number;
  projectRoleRequests: number;
  partnerApplicationDomains: number;
  tasks: number;
  mentorshipPairs: number;
};

// Prisma _count select shape — kept here so callers don't repeat it.
export const DOMAIN_USAGE_COUNT_SELECT = {
  applicationCycles: true,
  domainLeadAssignments: true,
  cycleReviewers: true,
  cycleInterviewers: true,
  delibsSessions: true,
  eligibilities: true,
  projectAssignments: true,
  projects: true,
  projectScopes: true,
  projectRoleRequests: true,
  partnerApplicationDomains: true,
  tasks: true,
  mentorshipPairs: true,
} as const;

export function describeDomainUsage(counts: DomainUsageCounts): string[] {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${n} ${RELATION_LABELS[key] ?? key}`);
}
