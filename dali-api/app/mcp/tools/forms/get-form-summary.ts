// MCP tool: get_form_summary — per-question results for one form version.
// Scope: mcp:read; edit access on the form, behind form-upgrades.

import { canBuildForm } from "~/forms/lib/form-access.server";
import { loadFormForEdit } from "~/forms/lib/forms-data";
import { loadVersionSummary } from "~/forms/lib/version-summary.server";
import {
  McpForbiddenError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";
import { requireFormUpgrades } from "./require-form-upgrades";

export const GET_FORM_SUMMARY_TOOL = {
  name: "get_form_summary",
  description:
    "Return the results Summary for one form version: the response total and per-question counts and percentages, across every response rather than one page. Needs edit access on the form.",
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
    },
    required: ["formId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = { formId: string; versionNumber?: number; slot?: string };

export async function runGetFormSummary(ctx: McpCtx, args: Args) {
  if (!(await canBuildForm(ctx.user.id, args.formId))) {
    throw new McpForbiddenError("You do not have edit access to this form");
  }
  await requireFormUpgrades(ctx);

  const form = await loadFormForEdit(args.formId);
  if (!form) throw new McpNotFoundError(`Form not found: ${args.formId}`);
  const version =
    args.versionNumber != null
      ? form.versions.find((v) => v.versionNumber === args.versionNumber)
      : form.versions[form.versions.length - 1];
  if (!version) throw new McpNotFoundError("Form version not found");

  const { summary, slotOptions } = await loadVersionSummary(form.id, version, { slot: args.slot });
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
