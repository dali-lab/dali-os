// MCP `correct_assignment_level` — post-finalize Core correction tool for a
// ProjectAssignment.level.
//
// Mirrors POST /api/projects/assignments/:id/level. Enforces the same guards:
//   1. Target level ≤ DomainEligibility ceiling (promote eligibility first).
//   2. Demotion blocked while the member has active MentorshipPair rows as
//      mentor on (project, term, domain) — reassign mentees first.
//
// Gate: mcp:admin, isCore.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { McpForbiddenError, McpNotFoundError, McpInvalidError } from "./errors";

const LEVELS = ["P1", "P2", "P3"] as const;
type Level = (typeof LEVELS)[number];
const LEVEL_RANK: Record<Level, number> = { P1: 1, P2: 2, P3: 3 };

export const CORRECT_ASSIGNMENT_LEVEL_TOOL = {
  name: "correct_assignment_level",
  description:
    "Core-only post-finalize correction for a ProjectAssignment.level. Guards: target level must be within DomainEligibility ceiling; demotion is blocked while the member is mentoring active mentees on the same (project, term, domain). Use the eligibility editor for promotions, this for fixing mistakes. Core only (mcp:admin).",
  inputSchema: {
    type: "object" as const,
    properties: {
      assignmentId: {
        type: "string",
        minLength: 1,
        description: "ProjectAssignment.id to correct.",
      },
      level: {
        type: "string",
        enum: [...LEVELS],
        description: "Target level: P1, P2, or P3.",
      },
    },
    required: ["assignmentId", "level"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type CorrectAssignmentLevelInput = { assignmentId: string; level: string };

export async function runCorrectAssignmentLevel(
  callerId: string,
  input: CorrectAssignmentLevelInput,
): Promise<{ ok: true; level?: Level; unchanged?: true }> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core can correct assignment levels.");
  }

  const targetLevel = input.level as Level;
  if (!LEVELS.includes(targetLevel)) {
    throw new McpInvalidError(`Invalid level. Must be one of: ${LEVELS.join(", ")}.`);
  }

  const assignment = await prisma.projectAssignment.findUnique({
    where: { id: input.assignmentId },
    select: {
      id: true,
      userId: true,
      projectId: true,
      termId: true,
      domainId: true,
      level: true,
      domain: { select: { displayName: true } },
    },
  });
  if (!assignment) throw new McpNotFoundError("Assignment not found.");

  if (assignment.level === targetLevel) {
    return { ok: true, unchanged: true };
  }

  // Guard 1: eligibility ceiling.
  const eligibility = await prisma.domainEligibility.findUnique({
    where: { userId_domainId: { userId: assignment.userId, domainId: assignment.domainId } },
    select: { level: true },
  });
  const ceiling = eligibility?.level as Level | undefined;
  if (!ceiling || LEVEL_RANK[targetLevel] > LEVEL_RANK[ceiling]) {
    throw new McpInvalidError(
      `Member is not eligible for ${targetLevel} in ${assignment.domain.displayName}. Promote them in the eligibility editor first.`,
    );
  }

  // Guard 2: demotion while actively mentoring.
  const isDemotion = LEVEL_RANK[targetLevel] < LEVEL_RANK[assignment.level as Level];
  if (isDemotion) {
    const menteeCount = await prisma.mentorshipPair.count({
      where: {
        mentorUserId: assignment.userId,
        projectId: assignment.projectId,
        termId: assignment.termId,
        domainId: assignment.domainId,
      },
    });
    if (menteeCount > 0) {
      throw new McpInvalidError(
        `Cannot demote: member is mentoring ${menteeCount} mentee${menteeCount === 1 ? "" : "s"} in ${assignment.domain.displayName}. Reassign mentees first.`,
      );
    }
  }

  await prisma.projectAssignment.update({
    where: { id: assignment.id },
    data: { level: targetLevel },
  });

  return { ok: true, level: targetLevel };
}
