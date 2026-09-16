// MCP tool: check_in_to_session — student self-check-in via the QR path.
// Reuses selfCheckInToSession from session-checkin.server.ts (the same fn the
// api.education.sessions.$sessionId.check-in.ts route calls).
// Gate: student self (caller must be an Approved enrollee; check-in window open).
// Scope: mcp:write.

import { selfCheckInToSession } from "~/education/lib/session-checkin.server";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const CHECK_IN_TO_SESSION_TOOL = {
  name: "check_in_to_session",
  description:
    "Mark yourself present for a session via self check-in. The instructor must have the check-in window open (set_check_in_open), and you must be an Approved enrollee.",
  inputSchema: {
    type: "object" as const,
    properties: {
      sessionId: { type: "string", minLength: 1 },
    },
    required: ["sessionId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = { sessionId: string };

export async function runCheckInToSession(ctx: McpCtx, args: Args) {
  const result = await selfCheckInToSession({
    sessionId: args.sessionId,
    userId: ctx.user.id,
  });

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    if (result.status === 403) throw new McpForbiddenError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true, alreadyPresent: result.alreadyPresent };
}

export const CHECK_IN_TO_SESSION: McpTool = {
  def: CHECK_IN_TO_SESSION_TOOL,
  run: (ctx: McpCtx, args) => runCheckInToSession(ctx, args as Args),
};
