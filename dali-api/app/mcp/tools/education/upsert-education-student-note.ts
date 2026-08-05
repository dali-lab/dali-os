// MCP tool: upsert_education_student_note — write the student-visible feedback
// note for an enrolled student. Instructor or Core only. Scope: mcp:write.

import { upsertStudentNote } from "~/education/lib/student-notes.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { prisma } from "~/lib/db";
import type { McpCtx, McpTool } from "../../registry";
import { McpForbiddenError, McpNotFoundError, McpInvalidError } from "../../registry";

export const UPSERT_EDUCATION_STUDENT_NOTE_TOOL = {
  name: "upsert_education_student_note",
  description:
    "Write the student-visible feedback note for an enrolled student. Instructor or Core only. This is the feedback lane only — the internal hiring note is not exposed here. Pass null to clear.",
  inputSchema: {
    type: "object" as const,
    properties: {
      applicationId: {
        type: "string",
        minLength: 1,
        description: "EducationApplication.id of the student.",
      },
      offeringId: {
        type: "string",
        minLength: 1,
        description: "Used to verify the application belongs to an offering you manage.",
      },
      feedback: {
        type: "string",
        description: "Student-visible feedback text. Pass empty string to clear.",
      },
    },
    required: ["applicationId", "offeringId", "feedback"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  applicationId: string;
  offeringId: string;
  feedback: string;
};

export async function runUpsertEducationStudentNote(ctx: McpCtx, args: Input) {
  if (!(await isOfferingManager(ctx.user.id, args.offeringId))) {
    throw new McpForbiddenError();
  }

  const application = await prisma.educationApplication.findUnique({
    where: { id: args.applicationId },
    select: { offeringId: true },
  });
  if (!application || application.offeringId !== args.offeringId) {
    throw new McpNotFoundError("Application not found");
  }

  const result = await upsertStudentNote({
    applicationId: args.applicationId,
    actorId: ctx.user.id,
    feedback: args.feedback,
  });

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true };
}

export const UPSERT_EDUCATION_STUDENT_NOTE: McpTool = {
  def: UPSERT_EDUCATION_STUDENT_NOTE_TOOL,
  run: (ctx: McpCtx, args) => runUpsertEducationStudentNote(ctx, args as Input),
};
