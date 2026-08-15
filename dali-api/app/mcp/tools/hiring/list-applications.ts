// MCP `list_applications` — summary rows for domain applications in a cycle.
// Access mirrors the /hiring/applications web route:
//   Core / domain leads → all domains in the cycle.
//   CycleReviewers → only their assigned domains for this cycle.
//   CycleInterviewers without a reviewer row → same as reviewers (cycle access
//   check passes, but they see only their own reviewer domains; if they have no
//   reviewer row they get an empty list).
//   No cycle access → McpForbiddenError.
//
// No confidentiality gate — same as the web route (the list view does not
// expose raw applicant answers).

import { prisma } from "~/lib/db";
import { getUserRoles, hasCycleAccess } from "~/lib/roles";
import { McpForbiddenError, McpNotFoundError } from "../../registry";

export const LIST_APPLICATIONS_TOOL = {
  name: "list_applications",
  description:
    "List domain application summary rows for a hiring cycle. Optionally filter by domain or application status. Core/domain-leads see all domains; reviewers see only their assigned domains. Returns applicant summary rows (no full answers).",
  inputSchema: {
    type: "object" as const,
    properties: {
      cycleId: {
        type: "string",
        minLength: 1,
        description: "ApplicationCycle.id to list applications for.",
      },
      domainId: {
        type: "string",
        description: "Optional domain filter. Only return applications for this domain.",
      },
      status: {
        type: "string",
        description:
          "Optional application status filter (e.g. Submitted, Draft, Withdrawn).",
      },
    },
    required: ["cycleId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { cycleId: string; domainId?: string; status?: string };

export async function runListApplications(userId: string, input: Input): Promise<unknown> {
  // Verify cycle exists first.
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: input.cycleId },
    select: { id: true },
  });
  if (!cycle) throw new McpNotFoundError("Cycle not found");

  if (!(await hasCycleAccess(userId, input.cycleId))) {
    throw new McpForbiddenError("No access to this cycle");
  }

  const roles = await getUserRoles(userId);

  // Determine which domain IDs this caller may see.
  let visibleDomainIds: string[] | null = null; // null = all

  if (!roles.isCore && !roles.isDomainLead) {
    // Reviewer-scoped: only the domains they're a CycleReviewer for on THIS cycle.
    const reviewerRows = await prisma.cycleReviewer.findMany({
      where: { userId, applicationCycleId: input.cycleId },
      select: { domainId: true },
    });
    visibleDomainIds = reviewerRows.map((r) => r.domainId);
    // If they have no reviewer rows but still passed hasCycleAccess (they're
    // an interviewer only), return empty — they can't see the list view.
    if (visibleDomainIds.length === 0) return [];
  }

  // Build domain filter combining caller visibility + optional input filter.
  const effectiveDomainIds: string[] | undefined =
    input.domainId
      ? visibleDomainIds
        ? visibleDomainIds.includes(input.domainId)
          ? [input.domainId]
          : [] // requested domain not in their scope → empty result
        : [input.domainId]
      : visibleDomainIds ?? undefined;

  // If scope collapses to zero domains, return early.
  if (effectiveDomainIds !== undefined && effectiveDomainIds.length === 0) return [];

  const whereOr = effectiveDomainIds
    ? [{ domainId: { in: effectiveDomainIds } }]
    : undefined;

  const domainApps = await prisma.domainApplication.findMany({
    where: {
      application: { applicationCycleId: input.cycleId },
      selected: true,
      ...(whereOr ? { OR: whereOr } : {}),
    },
    select: {
      id: true,
      domainId: true,
      domain: { select: { displayName: true, name: true } },
      application: {
        select: {
          id: true,
          user: {
            select: { firstName: true, lastName: true },
          },
          statusUpdates: {
            orderBy: { createdAt: "desc" },
            select: { newStatus: true, createdAt: true },
          },
        },
      },
      _count: { select: { reviews: true } },
    },
    orderBy: [
      { application: { user: { lastName: "asc" } } },
      { application: { user: { firstName: "asc" } } },
    ],
  });

  // Filter by status client-side (mirrors the web route approach; status is
  // event-sourced so we can't push the filter into Prisma directly).
  const filtered = input.status
    ? domainApps.filter((da) => (da.application.statusUpdates[0]?.newStatus ?? "Draft") === input.status)
    : domainApps;

  return filtered.map((da) => {
    const u = da.application.user;
    const updates = da.application.statusUpdates;
    const currentStatus = updates[0]?.newStatus ?? "Draft";
    const submittedAt =
      updates.find((s) => s.newStatus === "Submitted")?.createdAt ?? null;
    const domainDisplay =
      da.domain?.displayName ??
      da.domain?.name ??
      null;
    return {
      domainApplicationId: da.id,
      applicationId: da.application.id,
      applicantName: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null,
      domain: domainDisplay,
      domainId:
        da.domainId ??
        null,
      status: currentStatus,
      submittedAt: submittedAt ? submittedAt.toISOString() : null,
      reviewCount: da._count.reviews,
    };
  });
}
