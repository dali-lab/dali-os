import { prisma } from "~/lib/db";
import { applicationBlindLabelsForCycle } from "~/hiring/lib/anonymization.server";
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
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: input.cycleId },
    select: { id: true, anonymizeReview: true },
  });
  if (!cycle) throw new McpNotFoundError("Cycle not found");

  if (!(await hasCycleAccess(userId, input.cycleId))) {
    throw new McpForbiddenError("No access to this cycle");
  }

  const roles = await getUserRoles(userId);

  let visibleDomainIds: string[] | null = null; // null = all

  if (!roles.isCore && !roles.isDomainLead) {
    const reviewerRows = await prisma.cycleReviewer.findMany({
      where: { userId, applicationCycleId: input.cycleId },
      select: { domainId: true },
    });
    visibleDomainIds = reviewerRows.map((r) => r.domainId);
    if (visibleDomainIds.length === 0) return { applications: [] };
  }

  const effectiveDomainIds: string[] | undefined =
    input.domainId
      ? visibleDomainIds
        ? visibleDomainIds.includes(input.domainId)
          ? [input.domainId]
          : []
        : [input.domainId]
      : visibleDomainIds ?? undefined;

  if (effectiveDomainIds !== undefined && effectiveDomainIds.length === 0) return { applications: [] };

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
          user: { select: { firstName: true, lastName: true } },
          statusUpdates: {
            orderBy: { createdAt: "desc" },
            select: { newStatus: true, createdAt: true },
          },
        },
      },
      _count: { select: { reviews: true } },
    },
  });

  // Status is event-sourced, so the filter can't be pushed into Prisma.
  const filtered = input.status
    ? domainApps.filter((da) => (da.application.statusUpdates[0]?.newStatus ?? "Draft") === input.status)
    : domainApps;

  const blindLabels = await blindLabelsFor(
    input.cycleId,
    cycle.anonymizeReview,
    filtered.map((da) => da.application.id),
  );

  // Wrapped in an object: MCP `structuredContent` must be a JSON object, so a
  // bare array fails result validation on the client before the caller sees it.
  // Sorted after blinding (as the web list is) so row order can't leak the
  // alphabetical position of a blinded applicant's real name.
  return {
    applications: filtered
      .map((da) => {
        const u = da.application.user;
        const updates = da.application.statusUpdates;
        const submittedAt = updates.find((s) => s.newStatus === "Submitted")?.createdAt ?? null;
        return {
          domainApplicationId: da.id,
          applicationId: da.application.id,
          applicantName:
            blindLabels.get(da.application.id) ??
            (`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null),
          domain: da.domain?.displayName ?? da.domain?.name ?? null,
          domainId: da.domainId ?? null,
          status: updates[0]?.newStatus ?? "Draft",
          submittedAt: submittedAt ? submittedAt.toISOString() : null,
          reviewCount: da._count.reviews,
        };
      })
      .sort(
        (a, b) =>
          (a.applicantName ?? "").localeCompare(b.applicantName ?? "", undefined, { numeric: true }) ||
          (a.domain ?? "").localeCompare(b.domain ?? ""),
      ),
  };
}

// Blinding is a whole-application state: every selected domain counts, including
// ones outside this caller's visible set, so they're looked up separately.
async function blindLabelsFor(
  cycleId: string,
  anonymizeReview: boolean,
  applicationIds: string[],
): Promise<Map<string, string>> {
  if (!anonymizeReview || applicationIds.length === 0) return new Map();
  const allSelected = await prisma.domainApplication.findMany({
    where: { applicationId: { in: [...new Set(applicationIds)] }, selected: true },
    select: { id: true, applicationId: true },
  });
  const daIdsByApplication = new Map<string, string[]>();
  for (const row of allSelected) {
    const arr = daIdsByApplication.get(row.applicationId) ?? [];
    arr.push(row.id);
    daIdsByApplication.set(row.applicationId, arr);
  }
  return applicationBlindLabelsForCycle({
    cycleId,
    anonymizeReview,
    applications: [...daIdsByApplication.entries()].map(([id, daIds]) => ({ id, daIds })),
  });
}
