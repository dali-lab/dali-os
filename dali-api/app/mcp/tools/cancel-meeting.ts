// MCP `cancel_meeting` — cancel a ScheduledMeeting the caller organizes.
// Wraps the same `cancelScheduledMeeting` helper used by
// `api.scheduled-meetings.$id.cancel.ts`: organizer-only, idempotent, flips
// status to Cancelled (which pulls the invite from every recipient's
// inbox/tasks). Requires the `mcp:write` scope.

import { cancelScheduledMeeting } from "~/lib/scheduled-meeting";

export const CANCEL_MEETING_TOOL = {
  name: "cancel_meeting",
  description:
    "Cancel a meeting the authenticated member organizes. Only the organizer may cancel. Idempotent — cancelling an already-cancelled meeting returns alreadyCancelled=true.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meetingId: {
        type: "string",
        minLength: 1,
        description: "ScheduledMeeting.id, as returned by `list_my_upcoming_meetings` or `schedule_meeting`.",
      },
    },
    required: ["meetingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { meetingId: string };

export class CancelMeetingError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CancelMeetingError";
  }
}

export async function runCancelMeeting(callerId: string, input: Input) {
  const result = await cancelScheduledMeeting(input.meetingId, callerId);
  if (!result.ok) throw new CancelMeetingError(result.error, result.status);
  return { ok: true, alreadyCancelled: result.alreadyCancelled };
}
