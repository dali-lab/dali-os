// MCP tool: get_form_responses — paginated submission grid for a form.
// Scope: mcp:read; edit access on the form.

import { prisma } from "~/lib/db.server";
import { canBuildForm } from "~/forms/lib/form-access.server";
import { buildResponseGrid } from "~/forms/lib/answer-rows.server";
import { versionResponsesWhere } from "~/forms/lib/version-responses.server";
import { validateAnswerFilterInputs, type AnswerFilterInput } from "~/forms/lib/answer-filters";
import type { Question } from "~/types";
import {
  McpForbiddenError,
  McpInvalidError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";
import { keysetPage, keysetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const GET_FORM_RESPONSES_TOOL = {
  name: "get_form_responses",
  description:
    "Return form submissions, newest first, as a response grid (columns + per-submission answer rows). Needs edit access on the form. Pass page.nextCursor as cursor to read the next page until page.hasMore is false; page.total is the full submission count, or the matching count when q, slot or answers narrow it. q searches name, email and answer text; q and answers need versionNumber.",
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
        description: "If provided, filter to submissions for this version only. Required with q or answers.",
      },
      q: {
        type: "string",
        description: "Only submissions where every word appears in the respondent's name, email or an answer. Needs versionNumber.",
      },
      slot: {
        type: "string",
        description: "Only submissions filled for this slot.",
      },
      answers: {
        type: "array",
        description:
          "Filter by answers; every filter must match. One per question, using the question's key from get_form. kind is: is (values: option strings, or \"__other__\" for an answer outside the options; a checkbox matches when it includes any), contains (text, case-insensitive; text, textarea, email and URL questions), range (min and/or max, inclusive; number or YYYY-MM-DD date questions), answered or blank (any filterable question; blank also covers a question a rule hid). File and skills rating questions can't be filtered.",
        items: {
          type: "object",
          properties: {
            questionKey: { type: "string" },
            kind: { type: "string", enum: ["is", "contains", "range", "answered", "blank"] },
            values: { type: "array", items: { type: "string" } },
            text: { type: "string" },
            min: { type: ["string", "number"] },
            max: { type: ["string", "number"] },
          },
          required: ["questionKey", "kind"],
          additionalProperties: false,
        },
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
  q?: string;
  slot?: string;
  answers?: AnswerFilterInput[];
};

async function resultsWhere(args: Args) {
  const answers = args.answers ?? [];
  const q = args.q?.trim() ?? "";
  if (answers.length === 0 && !q) {
    return {
      formId: args.formId,
      ...(args.versionNumber != null ? { formVersion: { versionNumber: args.versionNumber } } : {}),
      ...(args.slot ? { slot: args.slot } : {}),
    };
  }
  if (args.versionNumber == null) {
    throw new McpInvalidError("q and answers are read against one version's questions, so pass versionNumber");
  }
  const version = await prisma.formVersion.findFirst({
    where: { formId: args.formId, versionNumber: args.versionNumber },
    select: { id: true, questions: true },
  });
  if (!version) throw new McpNotFoundError("Form version not found");
  const questions = (version.questions as unknown as Question[]) ?? [];
  const { filters, errors } = validateAnswerFilterInputs(answers, questions);
  if (errors.length) throw new McpInvalidError(errors.join("; "));
  return versionResponsesWhere(args.formId, version.id, { q, slot: args.slot, answers: filters, questions });
}

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
  const baseWhere = await resultsWhere(args);

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
