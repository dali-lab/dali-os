import type { McpCtx } from "../../registry";
import { McpInvalidError } from "../../errors";
import { runCheckInToSession } from "../education/check-in-to-session";
import { runCheckInToMeeting } from "./check-in-to-meeting";

export const CHECK_IN_DEF = {
  name: "check_in",
  description:
    "Mark yourself present. Pass meetingId for a SelfCheckIn meeting (allowed within 15 minutes of its start or end) or sessionId for an education session (you must be an Approved enrollee and the instructor must have opened check-in). Exactly one.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meetingId: { type: "string", minLength: 1, description: "ScheduledMeeting.id. Use this or sessionId." },
      sessionId: { type: "string", minLength: 1, description: "Education session id. Use this or meetingId." },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runCheckIn(ctx: McpCtx, args: { meetingId?: string; sessionId?: string }) {
  if (!args.meetingId === !args.sessionId) {
    throw new McpInvalidError("Pass exactly one of meetingId or sessionId");
  }
  if (args.meetingId) return runCheckInToMeeting(ctx.user.id, { meetingId: args.meetingId });
  return runCheckInToSession(ctx, { sessionId: args.sessionId! });
}
