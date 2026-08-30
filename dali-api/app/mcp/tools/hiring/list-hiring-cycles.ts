// MCP `list_hiring_cycles` — lists ApplicationCycle rows the caller may see.
// Access:
//   Admin → all cycles.
//   Core (hiring lead) / DomainLeadAssignment holder → all Standard/Fellowship
//     cycles, plus any Core cycle they're assigned on. Core cycles are otherwise
//     hidden from them (Core-cycle data is Admin + assigned-reviewers only).
//   CycleReviewer / CycleInterviewer → only cycles they're assigned on.
//   Everyone else → McpForbiddenError.
// Requires mcp:read scope.

import { prisma } from "~/lib/db";
import { getUserRoles } from "~/lib/roles";
import { McpForbiddenError } from "../../registry";

export const LIST_HIRING_CYCLES_TOOL = {
  name: "list_hiring_cycles",
  description:
    "List hiring cycles visible to the caller. Core and domain leads see all cycles; reviewers/interviewers see only cycles they are assigned on. Returns id, name, term, cycleType, status, open/close dates.",
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
  // surface Core cycles the caller is assigned on even when they aren't Admin.
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
        ? { OR: [{ cycleType: { not: "Core" } }, { id: { in: assignedCycleIds } }] }
        : { id: { in: assignedCycleIds } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      cycleType: true,
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
    cycleType: c.cycleType,
    status: c.statusUpdates[0]?.newStatus ?? "Draft",
    closeDate: c.closeDate?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  }));
}
