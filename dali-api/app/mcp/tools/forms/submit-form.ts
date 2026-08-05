// MCP tool: submit_form — submit a response to a published form by public token.
// Scope: mcp:write. Access gated by formFillAccess (audience rules); no
// anonymous path — MCP always has a session user.

import {
  formAccessMeta,
  formFillAccess,
  submitMemberForm,
} from "~/forms/lib/public-form";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const SUBMIT_FORM_TOOL = {
  name: "submit_form",
  description:
    "Submit a response to a published form addressed by its public token. Access is audience-gated (Members / SignedIn / Groups / Public). Always submits as the authenticated caller — no anonymous path.",
  inputSchema: {
    type: "object" as const,
    properties: {
      token: {
        type: "string",
        description: "The form's public token (from the fill URL).",
      },
      versionId: {
        type: "string",
        description: "The form version ID to submit against.",
      },
      answers: {
        type: "object",
        description: "Answer map: question key → answer value.",
        additionalProperties: true,
      },
    },
    required: ["token", "versionId", "answers"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = {
  token: string;
  versionId: string;
  answers: Record<string, unknown>;
};

export async function runSubmitForm(ctx: McpCtx, args: Args) {
  const meta = await formAccessMeta(args.token);
  if (!meta) {
    throw new McpNotFoundError("Form not found or not published");
  }

  const access = await formFillAccess(meta, ctx.user.id);
  if (access === "denied" || access === "login") {
    throw new McpForbiddenError("You are not permitted to fill this form");
  }

  const result = await submitMemberForm({
    token: args.token,
    versionId: args.versionId,
    userId: ctx.user.id,
    answers: args.answers,
  });

  if (!("ok" in result)) {
    const r = result as { error: string; status: number };
    if (r.status === 404) throw new McpNotFoundError(r.error);
    throw new McpInvalidError(r.error);
  }

  return { ok: true };
}

export const SUBMIT_FORM: McpTool = {
  def: SUBMIT_FORM_TOOL,
  run: (ctx: McpCtx, args) => runSubmitForm(ctx, args as Args),
};
