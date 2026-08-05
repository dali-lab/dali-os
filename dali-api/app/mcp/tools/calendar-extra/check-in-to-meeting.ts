// MCP `check_in_to_meeting` — self check-in for SelfCheckIn-mode meetings.
// Mirrors the logic of api.scheduled-meetings.$id.check-in.ts exactly.
// Requires the `mcp:write` scope.

import { prisma } from "~/lib/db";
import { markMeetingAttendance } from "~/lib/scheduled-meeting";
import { McpNotFoundError, McpInvalidError, McpForbiddenError } from "../../registry";

export const CHECK_IN_TO_MEETING_DEF = {
  name: "check_in_to_meeting",
  description:
    "Self check-in to a meeting with SelfCheckIn attendance mode. Only allowed within ±15 minutes of the meeting window.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meetingId: {
        type: "string",
        minLength: 1,
        description: "ScheduledMeeting.id to check in to.",
      },
    },
    required: ["meetingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const CHECK_IN_GRACE_MIN = 15;

type Input = { meetingId: string };

export async function runCheckInToMeeting(userId: string, input: Input) {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      attendanceMode: true,
      selectedAt: true,
      durationMinutes: true,
    },
  });

  if (!meeting || meeting.attendanceMode !== "SelfCheckIn") {
    throw new McpNotFoundError("Meeting not found");
  }

  if (!meeting.selectedAt) {
    throw new McpInvalidError("This meeting doesn't have a scheduled time yet");
  }

  const graceMs = CHECK_IN_GRACE_MIN * 60_000;
  const windowStart = meeting.selectedAt.getTime() - graceMs;
  const windowEnd =
    meeting.selectedAt.getTime() + meeting.durationMinutes * 60_000 + graceMs;
  const now = Date.now();

  if (now < windowStart || now > windowEnd) {
    throw new McpForbiddenError("Check-in window has closed");
  }

  const result = await markMeetingAttendance(meeting.id, userId, true, userId);
  if (!result.ok) {
    const status = result.status ?? 400;
    if (status === 404) throw new McpNotFoundError(result.error ?? "Not found");
    if (status === 403) throw new McpForbiddenError(result.error ?? "Forbidden");
    throw new McpInvalidError(result.error ?? "Check-in failed");
  }

  return { ok: true };
}
