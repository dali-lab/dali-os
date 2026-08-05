// MCP `list_hiring_cycles` — lists ApplicationCycle rows the caller may see.
// Access:
//   Core / any DomainLeadAssignment holder → all cycles.
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

  // Hard gate: user must have some hiring role.
  if (!roles.isCore && !roles.isDomainLead) {
    // Check for any reviewer / interviewer assignment.
    const [reviewer, interviewer] = await Promise.all([
      prisma.cycleReviewer.findFirst({ where: { userId }, select: { applicationCycleId: true } }),
      prisma.cycleInterviewer.findFirst({ where: { userId }, select: { applicationCycleId: true } }),
    ]);
    if (!reviewer && !interviewer) throw new McpForbiddenError("No hiring access");
  }

  // Build the where clause: Core / domain leads see everything; others see
  // only the cycles they have a reviewer/interviewer row for.
  let cycleIdFilter: string[] | null = null;
  if (!roles.isCore && !roles.isDomainLead) {
    const [reviewerRows, interviewerRows] = await Promise.all([
      prisma.cycleReviewer.findMany({ where: { userId }, select: { applicationCycleId: true } }),
      prisma.cycleInterviewer.findMany({ where: { userId }, select: { applicationCycleId: true } }),
    ]);
    const ids = new Set([
      ...reviewerRows.map((r) => r.applicationCycleId),
      ...interviewerRows.map((r) => r.applicationCycleId),
    ]);
    cycleIdFilter = [...ids];
  }

  const cycles = await prisma.applicationCycle.findMany({
    where: cycleIdFilter ? { id: { in: cycleIdFilter } } : {},
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
