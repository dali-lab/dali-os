// MCP tool: respond_partner_meeting_request — accept or decline a partner's
// self-service meeting request (specs/partner-crm.md §6). Scope: mcp:write.
// Gated to isCore. Thin wrapper over respondToMeetingRequest, the same
// helper the web /api/partner-meeting-requests/:id route calls.

import { isCore } from "~/lib/roles";
import { respondToMeetingRequest } from "~/partners/lib/partner-meetings.server";
import { McpForbiddenError, McpInvalidError, requireForAction } from "../../registry";

export const RESPOND_PARTNER_MEETING_REQUEST_TOOL = {
  name: "respond_partner_meeting_request",
  description:
    "Accept or decline a partner's meeting request (Core only). Accept schedules a real meeting " +
    "(Google invite + Meet link to the partner) across the request's resolved team; if a participant " +
    "has since gone busy, it still schedules and the result flags conflict:true with busyUserIds. " +
    "Decline takes an optional note and emails the partner.",
  inputSchema: {
    type: "object" as const,
    properties: {
      requestId: { type: "string", description: "PartnerMeetingRequest id." },
      action: { type: "string", enum: ["accept", "decline"], description: "What to do." },
      note: {
        type: "string",
        description: "Optional note — included in the decline email, or logged on accept.",
      },
    },
    required: ["requestId", "action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runRespondPartnerMeetingRequest(
  callerId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can respond to partner meeting requests");
  }

  const action = input.action as string;
  requireForAction(action, input, {
    accept: ["requestId"],
    decline: ["requestId"],
  });

  const requestId = (input.requestId as string).trim();
  const note = typeof input.note === "string" ? input.note.trim() || null : null;

  const result = await respondToMeetingRequest({
    requestId,
    actorUserId: callerId,
    action: action as "accept" | "decline",
    note,
  });
  if (!result.ok) throw new McpInvalidError(result.error);

  return {
    ok: true,
    ...(result.conflict ? { conflict: true, busyUserIds: result.busyUserIds } : {}),
    ...(result.scheduledMeetingId ? { scheduledMeetingId: result.scheduledMeetingId } : {}),
  };
}
