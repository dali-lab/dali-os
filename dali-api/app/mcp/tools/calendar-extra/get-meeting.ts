// MCP `get_meeting` — full detail for a single ScheduledMeeting including
// roster. Mirrors the calendar.meeting.$id loader. Requires `mcp:read` scope.

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { fullName } from "~/lib/display";
import { McpNotFoundError, McpForbiddenError } from "../../registry";

export const GET_MEETING_DEF = {
  name: "get_meeting",
  description:
    "Fetch full detail for a scheduled meeting: time, duration, URL, meeting type, Core flag, note page, and the attendance roster. Accessible to the organizer, Core members, project members, and any invited attendee.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meetingId: {
        type: "string",
        minLength: 1,
        description: "ScheduledMeeting.id.",
      },
    },
    required: ["meetingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { meetingId: string };

export async function runGetMeeting(callerId: string, input: Input) {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      title: true,
      organizerId: true,
      meetingType: true,
      meetingTypeLabel: true,
      attendanceMode: true,
      projectId: true,
      selectedAt: true,
      durationMinutes: true,
      status: true,
      isCoreMeeting: true,
      meetingUrl: true,
      recurrenceRule: true,
      organizer: { select: { firstName: true, lastName: true } },
      notePage: { select: { id: true } },
      attendance: {
        select: {
          userId: true,
          present: true,
          markedAt: true,
          user: { select: { firstName: true, lastName: true, daliEmail: true } },
        },
      },
    },
  });

  if (!meeting || meeting.status === "Cancelled") {
    throw new McpNotFoundError("Meeting not found");
  }

  // Same gate as the web: organizer, Core, or project member can manage;
  // any invited attendee can view.
  const [core, projectMember] = await Promise.all([
    isCore(callerId),
    meeting.projectId ? isProjectMember(callerId, meeting.projectId) : Promise.resolve(false),
  ]);
  const canManage = callerId === meeting.organizerId || core || projectMember;
  const viewerRow = meeting.attendance.find((a) => a.userId === callerId);
  if (!canManage && !viewerRow) throw new McpForbiddenError();

  const typeLabel =
    meeting.meetingType === "Other"
      ? meeting.meetingTypeLabel ?? "Meeting"
      : (meeting.meetingType ?? "Meeting");

  return {
    meetingId: meeting.id,
    title: meeting.title,
    status: meeting.status,
    startsAt: meeting.selectedAt?.toISOString() ?? null,
    durationMinutes: meeting.durationMinutes,
    meetingUrl: meeting.meetingUrl,
    recurrenceRule: meeting.recurrenceRule,
    meetingType: meeting.meetingType,
    typeLabel,
    isCoreMeeting: meeting.isCoreMeeting,
    attendanceMode: meeting.attendanceMode,
    projectId: meeting.projectId,
    organizerName: fullName(meeting.organizer),
    notePageId: meeting.notePage?.id ?? null,
    canManage,
    roster: meeting.attendance.map((a) => ({
      userId: a.userId,
      name: fullName(a.user) || a.user.daliEmail || a.userId,
      present: a.present,
      checkedInAt: a.markedAt?.toISOString() ?? null,
    })),
  };
}
