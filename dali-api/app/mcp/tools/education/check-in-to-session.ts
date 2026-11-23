import { selfCheckInToSession } from "~/education/lib/session-checkin.server";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  type McpCtx,
} from "../../registry";

export type CheckInToSessionArgs = { sessionId: string };

export async function runCheckInToSession(ctx: McpCtx, args: CheckInToSessionArgs) {
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
