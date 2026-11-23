import {
  requireForAction,
  type McpCtx,
  type McpTool,
} from "../../registry";
import { sendFormReminder } from "~/forms/lib/form-tracker.server";
import { requireFormEdit, unwrapFormResult } from "./shared";

export const REMIND_FORM_RESPONDENTS_TOOL = {
  name: "remind_form_respondents",
  description:
    "Email the people who haven't responded to a form, with your message and a link to it. Limited to one reminder per form every 24 hours. Needs edit access on the form.",
  inputSchema: {
    type: "object" as const,
    properties: {
      formId: {
        type: "string",
        description: "The form ID.",
      },
      message: {
        type: "string",
        description: "The reminder text.",
      },
    },
    required: ["formId", "message"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = { formId: string; message: string };

export async function runRemindFormRespondents(ctx: McpCtx, args: Args) {
  requireForAction("remind", args, { remind: ["formId", "message"] });
  await requireFormEdit(ctx.user.id, args.formId);
  return unwrapFormResult(
    await sendFormReminder({
      formId: args.formId,
      actorId: ctx.user.id,
      message: args.message,
      request: ctx.request,
    }),
  );
}

export const REMIND_FORM_RESPONDENTS: McpTool = {
  def: REMIND_FORM_RESPONDENTS_TOOL,
  run: (ctx: McpCtx, args) => runRemindFormRespondents(ctx, args as Args),
};
