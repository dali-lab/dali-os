// MCP tool: get_form_tracker — who is expected to respond and who hasn't.
// Scope: mcp:read; edit access on the form.

import { canBuildForm } from "~/forms/lib/form-access.server";
import { loadTrackerList } from "~/forms/lib/form-tracker.server";
import { McpForbiddenError, type McpCtx, type McpTool } from "../../registry";

export const GET_FORM_TRACKER_TOOL = {
  name: "get_form_tracker",
  description:
    "Return the response tracker for a form: how many people are expected, how many responded, and who hasn't, with dismissed people last. tracker is null when nobody is expected to respond. Needs edit access on the form.",
  inputSchema: {
    type: "object" as const,
    properties: {
      formId: {
        type: "string",
        description: "The form ID.",
      },
    },
    required: ["formId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = { formId: string };

export async function runGetFormTracker(ctx: McpCtx, args: Args) {
  if (!(await canBuildForm(ctx.user.id, args.formId))) {
    throw new McpForbiddenError("You do not have edit access to this form");
  }

  const list = await loadTrackerList(args.formId);
  return {
    formId: args.formId,
    tracker: list && { ...list, responded: list.expected - list.notResponded.length },
  };
}

export const GET_FORM_TRACKER: McpTool = {
  def: GET_FORM_TRACKER_TOOL,
  run: (ctx: McpCtx, args) => runGetFormTracker(ctx, args as Args),
};
