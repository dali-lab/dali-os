// MCP tool: save_education_attendance — record per-session attendance marks.
// Syncs CE credits in the same transaction. Instructor or Core only.
// Scope: mcp:write.

import { saveAttendance } from "~/education/lib/attendance.server";
import { isOfferingManager } from "~/education/lib/access.server";
import type { AttendanceStatus } from "~/generated/prisma/client";
import type { McpCtx, McpTool } from "../../registry";
import { McpForbiddenError, McpNotFoundError, McpInvalidError } from "../../registry";

export const SAVE_EDUCATION_ATTENDANCE_TOOL = {
  name: "save_education_attendance",
  description:
    "Record attendance for a session. Pass marks as an array of { applicationId, status } where status is Present | Absent | Excused, or null to clear the mark. Syncs CE credits in the same transaction. Instructor or Core only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      offeringId: { type: "string", minLength: 1 },
      sessionId: { type: "string", minLength: 1 },
      marks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            applicationId: { type: "string", minLength: 1 },
            status: {
              type: "string",
              enum: ["Present", "Absent", "Excused"],
              description: "Omit or pass null to clear the mark.",
            },
          },
          required: ["applicationId"],
          additionalProperties: false,
        },
        description:
          "Roster marks. applicationId is the EducationApplication.id (not the userId).",
      },
    },
    required: ["offeringId", "sessionId", "marks"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type MarkInput = { applicationId: string; status?: string };
type Input = { offeringId: string; sessionId: string; marks: MarkInput[] };

export async function runSaveEducationAttendance(ctx: McpCtx, args: Input) {
  if (!(await isOfferingManager(ctx.user.id, args.offeringId))) {
    throw new McpForbiddenError();
  }

  const marks = args.marks.map((m) => ({
    applicationId: m.applicationId,
    status: ((m as Record<string, unknown>).status ?? null) as AttendanceStatus | null,
  }));

  const result = await saveAttendance({
    offeringId: args.offeringId,
    sessionId: args.sessionId,
    marks,
    actorId: ctx.user.id,
  });

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true, marksProcessed: marks.length };
}

export const SAVE_EDUCATION_ATTENDANCE: McpTool = {
  def: SAVE_EDUCATION_ATTENDANCE_TOOL,
  run: (ctx: McpCtx, args) =>
    runSaveEducationAttendance(ctx, args as Input),
};
