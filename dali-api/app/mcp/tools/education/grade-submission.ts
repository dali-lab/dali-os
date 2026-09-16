// MCP tool: grade_submission — instructor/Core grades a student submission.
// Reuses gradeSubmission from assignments.server.ts.
// Gate: isOfferingManager (instructor or Core).
// Scope: mcp:write.
//
// Note: feedbackText is owned by the collab feedback doc room
// (edusubmission:{id}:feedback) — grading only sets the grade label + gradedAt
// + optional score. Feedback text is written via the collab pipeline.

import { gradeSubmission } from "~/education/lib/assignments.server";
import { isOfferingManager } from "~/education/lib/access.server";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const GRADE_SUBMISSION_TOOL = {
  name: "grade_submission",
  description:
    "Grade a student submission. Instructor or Core only. Sets the grade label (e.g. 'Pass', 'A', 'Complete') and optional numeric score. Feedback text is written separately via the collab pipeline (edusubmission:{id}:feedback room).",
  inputSchema: {
    type: "object" as const,
    properties: {
      submissionId: { type: "string", minLength: 1 },
      offeringId: { type: "string", minLength: 1 },
      grade: {
        type: "string",
        description:
          "Grade label (e.g. 'Pass', 'Fail', 'A', 'B+', 'Complete', 'Incomplete'). Send empty string to clear.",
      },
      score: {
        type: "number",
        description:
          "Numeric score (0..points). Only persisted when the assignment has a point value. Omit or null for complete/incomplete grading.",
      },
    },
    required: ["submissionId", "offeringId", "grade"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = {
  submissionId: string;
  offeringId: string;
  grade: string;
  score?: number | null;
};

export async function runGradeSubmission(ctx: McpCtx, args: Args) {
  if (!(await isOfferingManager(ctx.user.id, args.offeringId))) {
    throw new McpForbiddenError();
  }

  const result = await gradeSubmission({
    submissionId: args.submissionId,
    offeringId: args.offeringId,
    grade: args.grade,
    score: args.score ?? null,
    actorId: ctx.user.id,
  });

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true };
}

export const GRADE_SUBMISSION: McpTool = {
  def: GRADE_SUBMISSION_TOOL,
  run: (ctx: McpCtx, args) => runGradeSubmission(ctx, args as Args),
};
