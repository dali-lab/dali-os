// MCP tool: get_form_responses — paginated submission grid for a form.
// Scope: mcp:read; edit access on the form.

import { prisma } from "~/lib/db.server";
import { canBuildForm } from "~/forms/lib/form-access.server";
import { buildResponseGrid } from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";
import {
  McpForbiddenError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";
import { keysetPage, keysetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const GET_FORM_RESPONSES_TOOL = {
  name: "get_form_responses",
  description:
    "Return form submissions, newest first, as a response grid (columns + per-submission answer rows). Needs edit access on the form. Pass page.nextCursor as cursor to read the next page until page.hasMore is false; page.total is the full submission count.",
  inputSchema: {
    type: "object" as const,
    properties: {
      formId: {
        type: "string",
        description: "The form ID to load responses for.",
      },
      ...pageProps(PAGE_LIMITS),
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

type Args = PageArgs & {
  formId: string;
  versionNumber?: number;
};

export async function runGetFormResponses(ctx: McpCtx, args: Args) {
  if (!(await canBuildForm(ctx.user.id, args.formId))) {
    throw new McpForbiddenError("You do not have edit access to this form");
  }

  const form = await prisma.form.findUnique({
    where: { id: args.formId },
    select: { id: true, name: true },
  });
  if (!form) {
    throw new McpNotFoundError(`Form not found: ${args.formId}`);
  }

  const window = keysetWindow(args, PAGE_LIMITS, [{ field: "createdAt", direction: "desc", type: "date" }]);
  const baseWhere = {
    formId: args.formId,
    ...(args.versionNumber != null ? { formVersion: { versionNumber: args.versionNumber } } : {}),
  };

  const [totalCount, fetched] = await Promise.all([
    prisma.formSubmission.count({ where: baseWhere }),
    prisma.formSubmission.findMany({
      where: { AND: [baseWhere, window.where] },
      orderBy: window.orderBy,
      take: window.take,
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
  const { rows: submissions, page } = keysetPage(fetched, window, totalCount);

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
    page,
    columns: grid.columns,
    responses,
  };
}

export const GET_FORM_RESPONSES: McpTool = {
  def: GET_FORM_RESPONSES_TOOL,
  run: (ctx: McpCtx, args) => runGetFormResponses(ctx, args as Args),
};
