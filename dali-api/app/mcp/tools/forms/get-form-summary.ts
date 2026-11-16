// MCP tool: get_form_summary — per-question results for one form version.
// Scope: mcp:read; edit access on the form.

import { canBuildForm } from "~/forms/lib/form-access.server";
import { loadFormForEdit } from "~/forms/lib/forms-data";
import { loadVersionSummary } from "~/forms/lib/version-summary.server";
import { validateAnswerFilterInputs, type AnswerFilterInput } from "~/forms/lib/answer-filters";
import {
  McpForbiddenError,
  McpInvalidError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const GET_FORM_SUMMARY_TOOL = {
  name: "get_form_summary",
  description:
    "Return the results Summary for one form version: the response total and per-question counts and percentages, across every response rather than one page. Pass answers to count only responses with matching answers. Needs edit access on the form.",
  inputSchema: {
    type: "object" as const,
    properties: {
      formId: {
        type: "string",
        description: "The form ID.",
      },
      versionNumber: {
        type: "number",
        description: "The version to summarize. Defaults to the latest.",
      },
      slot: {
        type: "string",
        description: "If provided, count only responses filled for this slot. slotOptions in the result lists them.",
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

type Args = { formId: string; versionNumber?: number; slot?: string; answers?: AnswerFilterInput[] };

export async function runGetFormSummary(ctx: McpCtx, args: Args) {
  if (!(await canBuildForm(ctx.user.id, args.formId))) {
    throw new McpForbiddenError("You do not have edit access to this form");
  }

  const form = await loadFormForEdit(args.formId);
  if (!form) throw new McpNotFoundError(`Form not found: ${args.formId}`);
  const version =
    args.versionNumber != null
      ? form.versions.find((v) => v.versionNumber === args.versionNumber)
      : form.versions[form.versions.length - 1];
  if (!version) throw new McpNotFoundError("Form version not found");

  const { filters, errors } = validateAnswerFilterInputs(args.answers ?? [], version.questions);
  if (errors.length) throw new McpInvalidError(errors.join("; "));

  const { summary, slotOptions } = await loadVersionSummary(form.id, version, {
    slot: args.slot,
    answers: filters,
  });
  return {
    formId: form.id,
    formName: form.name,
    versionNumber: version.versionNumber,
    slotOptions,
    summary,
  };
}

export const GET_FORM_SUMMARY: McpTool = {
  def: GET_FORM_SUMMARY_TOOL,
  run: (ctx: McpCtx, args) => runGetFormSummary(ctx, args as Args),
};
