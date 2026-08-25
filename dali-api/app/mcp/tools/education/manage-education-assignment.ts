// MCP tool: manage_education_assignment — create, update, or delete an
// assignment within an education offering. Calls the same typed functions
// the HTTP routes use (createAssignment / updateAssignment / deleteAssignment)
// rather than a FormData dispatcher.
//
// Access: instructor or Core (isOfferingManager). Scope: mcp:write.

import {
  createAssignment,
  updateAssignment,
  deleteAssignment,
} from "~/education/lib/assignments.server";
import { isOfferingManager } from "~/education/lib/access.server";
import {
  requireForAction,
  McpNotFoundError,
  McpForbiddenError,
  McpInvalidError,
  type McpCtx,
  type McpTool,
} from "../../registry";
import type { SubmissionType } from "~/generated/prisma/client";

export const MANAGE_EDUCATION_ASSIGNMENT_TOOL = {
  name: "manage_education_assignment",
  description:
    "Create, update, or delete an assignment within an education offering. Instructor or Core only. Assignments can be scoped to the whole offering or to a specific session.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "delete"],
      },
      offeringId: { type: "string", minLength: 1 },
      assignmentId: {
        type: "string",
        description: "Required for update and delete.",
      },
      title: {
        type: "string",
        description: "Assignment title. Required for create and update.",
      },
      dueAt: {
        type: "string",
        description: "ISO datetime or empty string for no due date. Required for create.",
      },
      submissionType: {
        type: "string",
        enum: ["Text", "File", "Mixed"],
        description: "How students submit. Required for create.",
      },
      sessionId: {
        type: "string",
        description: "If provided, scopes the assignment to a session (create only).",
      },
      points: {
        type: "number",
        description: "Optional point value (≥ 1). Omit or null for complete/incomplete grading.",
      },
    },
    required: ["action", "offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = {
  action: string;
  offeringId: string;
  assignmentId?: string;
  title?: string;
  dueAt?: string;
  submissionType?: string;
  sessionId?: string;
  points?: number | null;
};

export async function runManageEducationAssignment(ctx: McpCtx, args: Args) {
  requireForAction(args.action, args, {
    create: ["title", "submissionType"],
    update: ["assignmentId", "title", "submissionType"],
    delete: ["assignmentId"],
  });

  if (!(await isOfferingManager(ctx.user.id, args.offeringId))) {
    throw new McpForbiddenError();
  }

  const parseDueAt = (raw: string | undefined): Date | null => {
    if (!raw || raw === "") return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  let result: { ok: true; id?: string } | { error: string; status: number };

  const parsePoints = (v: number | null | undefined): number | null => {
    if (v == null || !Number.isFinite(v) || v < 1) return null;
    return Math.round(v);
  };

  if (args.action === "create") {
    result = await createAssignment({
      offeringId: args.offeringId,
      sessionId: args.sessionId ?? null,
      title: args.title!,
      dueAt: parseDueAt(args.dueAt),
      submissionType: args.submissionType as SubmissionType,
      points: parsePoints(args.points),
      actorId: ctx.user.id,
    });
  } else if (args.action === "update") {
    result = await updateAssignment({
      assignmentId: args.assignmentId!,
      offeringId: args.offeringId,
      title: args.title!,
      dueAt: parseDueAt(args.dueAt),
      submissionType: args.submissionType as SubmissionType,
      points: parsePoints(args.points),
      actorId: ctx.user.id,
    });
  } else {
    // delete
    result = await deleteAssignment({
      assignmentId: args.assignmentId!,
      offeringId: args.offeringId,
      actorId: ctx.user.id,
    });
  }

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true, id: result.id ?? null };
}

export const MANAGE_EDUCATION_ASSIGNMENT: McpTool = {
  def: MANAGE_EDUCATION_ASSIGNMENT_TOOL,
  run: (ctx: McpCtx, args) => runManageEducationAssignment(ctx, args as Args),
};
