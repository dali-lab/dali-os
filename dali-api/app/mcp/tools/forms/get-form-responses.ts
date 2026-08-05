// MCP tool: get_form_responses — paginated submission grid for a form.
// Scope: mcp:read, Core only.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { buildResponseGrid } from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";
import {
  McpForbiddenError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const GET_FORM_RESPONSES_TOOL = {
  name: "get_form_responses",
  description:
    "Return paginated form submissions as a response grid (columns + per-submission answer rows). Core only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      formId: {
        type: "string",
        description: "The form ID to load responses for.",
      },
      limit: {
        type: "number",
        description: "Max responses to return (default 50, max 200).",
      },
      offset: {
        type: "number",
        description: "Number of responses to skip (default 0).",
      },
      versionNumber: {
        type: "number",
        description: "If provided, filter to submissions for this version only.",
      },
    },
    required: ["formId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = {
  formId: string;
  limit?: number;
  offset?: number;
  versionNumber?: number;
};

export async function runGetFormResponses(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core members can view form responses");
  }

  const form = await prisma.form.findUnique({
    where: { id: args.formId },
    select: { id: true, name: true },
  });
  if (!form) {
    throw new McpNotFoundError(`Form not found: ${args.formId}`);
  }

  const take = Math.min(args.limit ?? 50, 200);
  const skip = args.offset ?? 0;

  const [totalCount, submissions] = await Promise.all([
    prisma.formSubmission.count({
      where: {
        formId: args.formId,
        ...(args.versionNumber != null
          ? { formVersion: { versionNumber: args.versionNumber } }
          : {}),
      },
    }),
    prisma.formSubmission.findMany({
      where: {
        formId: args.formId,
        ...(args.versionNumber != null
          ? { formVersion: { versionNumber: args.versionNumber } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        createdAt: true,
        answers: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            daliEmail: true,
            personalEmail: true,
          },
        },
        formVersion: {
          select: { versionNumber: true, questions: true },
        },
        slot: true,
        submitterName: true,
        submitterEmail: true,
      },
    }),
  ]);

  const grid = await buildResponseGrid(
    submissions.map((s) => ({
      formVersion: {
        versionNumber: s.formVersion.versionNumber,
        questions: (s.formVersion.questions as unknown as Question[]) ?? [],
      },
      answers: (s.answers as Record<string, unknown>) ?? {},
    })),
  );

  const responses = submissions.map((s, i) => {
    const name = s.user
      ? `${s.user.firstName} ${s.user.lastName}`.trim()
      : (s.submitterName ?? "");
    const email = s.user
      ? (s.user.daliEmail ?? s.user.personalEmail ?? null)
      : (s.submitterEmail ?? null);
    return {
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      versionNumber: s.formVersion.versionNumber,
      name,
      email,
      slot: s.slot,
      rows: grid.rowsBySubmission[i] ?? [],
    };
  });

  return {
    formId: form.id,
    formName: form.name,
    totalCount,
    columns: grid.columns,
    responses,
  };
}

export const GET_FORM_RESPONSES: McpTool = {
  def: GET_FORM_RESPONSES_TOOL,
  run: (ctx: McpCtx, args) => runGetFormResponses(ctx, args as Args),
};
