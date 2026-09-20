// MCP `list_hiring_cycles` — lists ApplicationCycle rows the caller may see.
// Access:
//   Admin → all cycles.
//   Core (hiring lead) / DomainLeadAssignment holder → all Students/Interns
//     cycles, plus any Lab members cycle they're assigned on. Lab members
//     cycles are otherwise hidden from them (Admin + assigned reviewers only).
//   CycleReviewer / CycleInterviewer → only cycles they're assigned on.
//   Everyone else → McpForbiddenError.
// Requires mcp:read scope.

import { prisma } from "~/lib/db";
import { getUserRoles } from "~/lib/roles";
import { blockLabel, delibRounds, parseTimeline } from "~/hiring/lib/cycle-timeline";
import { McpForbiddenError } from "../../registry";

export const LIST_HIRING_CYCLES_TOOL = {
  name: "list_hiring_cycles",
  description:
    "List hiring cycles visible to the caller. Core and domain leads see all cycles; reviewers/interviewers see only cycles they are assigned on. Returns id, name, applicants (Students, Interns, or LabMembers), stages (challenges, interviews on/off), delibRounds (the cycle's delib round labels, in order), status, open/close dates.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListHiringCycles(userId: string): Promise<unknown> {
  const roles = await getUserRoles(userId);

  // Assigned cycle ids (reviewer or interviewer) — used for the hard gate and to
  // surface Lab members cycles the caller is assigned on even when not Admin.
  const [reviewerRows, interviewerRows] = await Promise.all([
    prisma.cycleReviewer.findMany({ where: { userId }, select: { applicationCycleId: true } }),
    prisma.cycleInterviewer.findMany({ where: { userId }, select: { applicationCycleId: true } }),
  ]);
  const assignedCycleIds = [
    ...new Set([
      ...reviewerRows.map((r) => r.applicationCycleId),
      ...interviewerRows.map((r) => r.applicationCycleId),
    ]),
  ];

  // Hard gate: user must have some hiring role.
  if (!roles.isCore && !roles.isDomainLead && assignedCycleIds.length === 0) {
    throw new McpForbiddenError("No hiring access");
  }

  const cycles = await prisma.applicationCycle.findMany({
    where: roles.isAdmin
      ? {}
      : roles.isCore || roles.isDomainLead
        ? { OR: [{ applicants: { not: "LabMembers" } }, { id: { in: assignedCycleIds } }] }
        : { id: { in: assignedCycleIds } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      applicants: true,
      hasChallenges: true,
      timeline: true,
      hasInterviews: true,
      closeDate: true,
      createdAt: true,
      statusUpdates: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { newStatus: true },
      },
    },
  });

  return cycles.map((c) => ({
    id: c.id,
    name: c.name,
    applicants: c.applicants,
    stages: {
      challenges: c.hasChallenges,
      interviews: c.hasInterviews,
    },
    delibRounds: delibRounds(parseTimeline(c.timeline)).map((r) => r.label),
    status: c.statusUpdates[0]?.newStatus ?? "Draft",
    closeDate: c.closeDate?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  }));
}
