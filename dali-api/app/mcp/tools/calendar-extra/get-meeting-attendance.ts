// MCP `get_meeting_attendance` — roster of attendees for a scheduled meeting.
// Gate mirrors the web route: organizer OR isCore OR isProjectMember for
// project-scoped meetings; project-less falls back to Core-only.
// Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { McpNotFoundError, McpForbiddenError } from "../../registry";

export const GET_MEETING_ATTENDANCE_DEF = {
  name: "get_meeting_attendance",
  description:
    "Get the attendance roster for a scheduled meeting. Caller must be the organizer, Core, or a project member for project-scoped meetings.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meetingId: {
        type: "string",
        minLength: 1,
        description: "ScheduledMeeting.id to fetch attendance for.",
      },
    },
    required: ["meetingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { meetingId: string };

export async function runGetMeetingAttendance(userId: string, input: Input) {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      title: true,
      organizerId: true,
      projectId: true,
      meetingType: true,
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

  return {
    meetingId: meeting.id,
    title: meeting.title,
    attendees: meeting.attendance.map((a) => ({
      userId: a.userId,
      firstName: a.user.firstName,
      lastName: a.user.lastName,
      email: a.user.daliEmail,
      present: a.present,
      checkedInAt: a.markedAt ? a.markedAt.toISOString() : null,
    })),
  };
}
