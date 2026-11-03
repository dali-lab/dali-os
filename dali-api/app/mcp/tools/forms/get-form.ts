// MCP tool: get_form — a form's definition, for building or for filling.
// Scope: mcp:read. By formId: edit access on the form. By token: the same
// audience gate as submit_form.

import { canBuildForm } from "~/forms/lib/form-access.server";
import { loadFormForEdit } from "~/forms/lib/forms-data";
import { formAccessMeta, formFillAccess, loadPublicForm } from "~/forms/lib/public-form";
import {
  McpForbiddenError,
  McpInvalidError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const GET_FORM_TOOL = {
  name: "get_form",
  description:
    "Read a form's definition. Pass exactly one of formId or token. formId needs edit access and returns everything an editor sees: settings, the window, audience, the draft, and every version with its questions, for example before a save_version, which replaces the whole question list. token is audience-gated like submit_form and returns the latest published version as a respondent sees it: versionId, questions with their keys, and live options for reference questions. Use that to build a submit_form call.",
  inputSchema: {
    type: "object" as const,
    properties: {
      formId: {
        type: "string",
        description: "The form ID, for the editor's view.",
      },
      token: {
        type: "string",
        description: "The form's public token (publicToken in list_forms), for the respondent's view.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = { formId?: string; token?: string };

export async function runGetForm(ctx: McpCtx, args: Args) {
  if (Boolean(args.formId) === Boolean(args.token)) {
    throw new McpInvalidError("Pass exactly one of formId or token");
  }

  if (args.formId) {
    if (!(await canBuildForm(ctx.user.id, args.formId))) {
      throw new McpForbiddenError("You do not have edit access to this form");
    }
    const form = await loadFormForEdit(args.formId);
    if (!form) throw new McpNotFoundError(`Form not found: ${args.formId}`);
    return form;
  }

  const meta = await formAccessMeta(args.token!);
  if (!meta) throw new McpNotFoundError("Form not found or not published");
  if ((await formFillAccess(meta, ctx.user.id)) !== "ok") {
    throw new McpForbiddenError("You are not permitted to fill this form");
  }
  const form = await loadPublicForm(args.token!, ctx.user.id);
  if (!form) throw new McpNotFoundError("Form not found or not published");
  return form;
}

export const GET_FORM: McpTool = {
  def: GET_FORM_TOOL,
  run: (ctx: McpCtx, args) => runGetForm(ctx, args as Args),
};
