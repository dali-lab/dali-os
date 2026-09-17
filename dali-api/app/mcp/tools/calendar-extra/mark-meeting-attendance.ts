// MCP `mark_meeting_attendance` — toggle a participant's attendance on a meeting
// that has MeetingAttendance rows (i.e., meetingType is set). Mirrors the logic
// of api.scheduled-meetings.$id.attendance.ts. Requires `mcp:write` scope.

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { markMeetingAttendance } from "~/lib/scheduled-meeting";
import { McpNotFoundError, McpForbiddenError, McpInvalidError } from "../../registry";

export const MARK_MEETING_ATTENDANCE_DEF = {
  name: "mark_meeting_attendance",
  description:
    "Mark a participant present or absent for a meeting. Only meetings created with a meetingType have an attendance roster. Allowed for: the meeting organizer, Core members, or project members of the meeting's project.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meetingId: {
        type: "string",
        minLength: 1,
        description: "ScheduledMeeting.id.",
      },
      userId: {
        type: "string",
        minLength: 1,
        description: "User.id of the participant to mark.",
      },
      present: {
        type: "boolean",
        description: "true = present, false = absent.",
      },
    },
    required: ["meetingId", "userId", "present"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { meetingId: string; userId: string; present: boolean };

export async function runMarkMeetingAttendance(callerId: string, input: Input) {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: { id: true, organizerId: true, projectId: true, meetingType: true },
  });

  if (!meeting || !meeting.meetingType) {
    throw new McpNotFoundError("Meeting not found");
  }

  const [core, member] = await Promise.all([
    isCore(callerId),
    meeting.projectId ? isProjectMember(callerId, meeting.projectId) : Promise.resolve(false),
  ]);
  const canEdit = callerId === meeting.organizerId || core || member;
  if (!canEdit) throw new McpForbiddenError();

  const result = await markMeetingAttendance(meeting.id, input.userId, input.present, callerId);
  if (!result.ok) {
    const status = result.status ?? 400;
    if (status === 404) throw new McpNotFoundError(result.error ?? "Not found");
    if (status === 403) throw new McpForbiddenError(result.error ?? "Forbidden");
    throw new McpInvalidError(result.error ?? "Attendance update failed");
  }

  return { ok: true };
}
