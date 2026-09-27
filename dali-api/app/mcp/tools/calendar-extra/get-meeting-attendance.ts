// MCP `get_meeting_attendance` — roster of attendees for a scheduled meeting.
// Gate mirrors the web route: organizer OR isCore OR isProjectMember for
// project-scoped meetings; project-less falls back to Core-only.
// Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { parseOccurrenceParam, resolveMeetingOccurrence } from "~/lib/scheduled-meeting";
import { McpNotFoundError, McpForbiddenError } from "../../registry";

export const GET_MEETING_ATTENDANCE_DEF = {
  name: "get_meeting_attendance",
  description:
    "Get the attendance roster for a scheduled meeting. A recurring meeting keeps a roster per occurrence; pass occurrenceStart to pick one (default: the first). Caller must be the organizer, Core, or a project member for project-scoped meetings.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meetingId: {
        type: "string",
        minLength: 1,
        description: "ScheduledMeeting.id to fetch attendance for.",
      },
      occurrenceStart: {
        type: "string",
        description: "For a recurring meeting, when the occurrence starts (ISO 8601).",
      },
    },
    required: ["meetingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { meetingId: string; occurrenceStart?: string };

export async function runGetMeetingAttendance(userId: string, input: Input) {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      title: true,
      organizerId: true,
      projectId: true,
      meetingType: true,
      selectedAt: true,
      createdAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      externalEventId: true,
      attendance: {
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              daliEmail: true,
            },
          },
        },
      },
    },
  });

  // 404 if not found OR no meetingType (matches web route guard)
  if (!meeting || !meeting.meetingType) {
    throw new McpNotFoundError("Meeting not found");
  }

  const [core, member] = await Promise.all([
    isCore(userId),
    meeting.projectId
      ? isProjectMember(userId, meeting.projectId)
      : Promise.resolve(false),
  ]);

  const canView = userId === meeting.organizerId || core || member;
  if (!canView) {
    throw new McpForbiddenError("You don't have access to this meeting's attendance");
  }

  const occurrence = await resolveMeetingOccurrence(meeting, parseOccurrenceParam(input.occurrenceStart));
  const key = occurrence.originalStart.getTime();

  return {
    meetingId: meeting.id,
    title: meeting.title,
    occurrenceStart: occurrence.originalStart.toISOString(),
    attendees: meeting.attendance
      .filter((a) => a.occurrenceStart.getTime() === key)
      .map((a) => ({
        userId: a.userId,
        firstName: a.user.firstName,
        lastName: a.user.lastName,
        email: a.user.daliEmail,
        present: a.present,
        checkedInAt: a.markedAt ? a.markedAt.toISOString() : null,
      })),
  };
}
