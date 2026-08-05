// MCP tool: get_education_assignment — assignment details plus the caller's
// own submission and instructor feedback. Requires an Approved enrollment in
// the offering, or instructor/Core access. Scope: mcp:read.

import { getAssignmentForStudent, offeringIdForAssignment } from "~/education/lib/assignments.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { prisma } from "~/lib/db";
import type { McpCtx, McpTool } from "../../registry";
import { McpNotFoundError, McpForbiddenError } from "../../registry";

export const GET_EDUCATION_ASSIGNMENT_TOOL = {
  name: "get_education_assignment",
  description:
    "Get an assignment's details including your own submission and instructor feedback. Requires an Approved enrollment in the offering, or instructor/Core access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      assignmentId: { type: "string", minLength: 1 },
      offeringId: {
        type: "string",
        minLength: 1,
        description:
          "The offering the assignment belongs to. Used to scope and verify access.",
      },
    },
    required: ["assignmentId", "offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { assignmentId: string; offeringId: string };

export async function runGetEducationAssignment(ctx: McpCtx, input: Input) {
  // Verify the assignment actually belongs to the stated offering.
  const owner = await offeringIdForAssignment(input.assignmentId);
  if (owner !== input.offeringId) throw new McpNotFoundError("Assignment not found");

  const manager = await isOfferingManager(ctx.user.id, input.offeringId);

  if (!manager) {
    // Non-managers must have an Approved enrollment.
    const enrollment = await prisma.educationApplication.findFirst({
      where: {
        applicantUserId: ctx.user.id,
        offeringId: input.offeringId,
        status: "Approved",
      },
      select: { id: true },
    });
    if (!enrollment) {
      throw new McpForbiddenError("Enrollment required to view this assignment");
    }
  }

  const result = await getAssignmentForStudent({
    assignmentId: input.assignmentId,
    offeringId: input.offeringId,
    studentId: ctx.user.id,
  });
  if (!result) throw new McpNotFoundError("Assignment not found");

  const { assignment, submission } = result;

  return {
    assignment: {
      ...assignment,
      dueAt: assignment.dueAt instanceof Date ? assignment.dueAt.toISOString() : (assignment.dueAt ?? null),
    },
    submission: submission
      ? {
          ...submission,
          submittedAt:
            submission.submittedAt instanceof Date
              ? submission.submittedAt.toISOString()
              : (submission.submittedAt ?? null),
          gradedAt:
            submission.gradedAt instanceof Date
              ? submission.gradedAt.toISOString()
              : (submission.gradedAt ?? null),
        }
      : null,
  };
}

export const GET_EDUCATION_ASSIGNMENT: McpTool = {
  def: GET_EDUCATION_ASSIGNMENT_TOOL,
  run: (ctx: McpCtx, args) =>
    runGetEducationAssignment(ctx, args as Input),
};
