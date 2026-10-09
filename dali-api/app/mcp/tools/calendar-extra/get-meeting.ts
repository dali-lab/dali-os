// MCP `get_meeting` — full detail for a single ScheduledMeeting including
// roster. Mirrors the calendar.meeting.$id loader. Requires `mcp:read` scope.

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { fullName } from "~/lib/display";
import { noteForOccurrence } from "~/lib/meeting-occurrences";
import { parseOccurrenceParam, resolveMeetingOccurrence } from "~/lib/scheduled-meeting";
import { McpNotFoundError, McpForbiddenError } from "../../registry";

export const GET_MEETING_DEF = {
  name: "get_meeting",
  description:
    "Fetch full detail for a scheduled meeting: time, duration, URL, meeting type, Core flag, note page, the attendance roster, and whether the occurrence has a finished transcript. A recurring meeting keeps a separate note and roster per occurrence; pass occurrenceStart to pick one (default: the first). Accessible to the organizer, Core members, project members, and any invited attendee.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meetingId: {
        type: "string",
        minLength: 1,
        description: "ScheduledMeeting.id.",
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
      createdAt: true,
      externalEventId: true,
      participantUserIds: true,
      durationMinutes: true,
      status: true,
      isCoreMeeting: true,
      meetingUrl: true,
      recurrenceRule: true,
      organizer: { select: { firstName: true, lastName: true } },
      notePages: { select: { id: true, meetingOccurrenceStart: true } },
      attendance: {
        select: {
          occurrenceStart: true,
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
  const invited =
    meeting.participantUserIds.includes(callerId) ||
    meeting.attendance.some((a) => a.userId === callerId);
  if (!canManage && !invited) throw new McpForbiddenError();

  const occurrence = await resolveMeetingOccurrence(meeting, parseOccurrenceParam(input.occurrenceStart));
  const key = occurrence.originalStart.getTime();
  const roster = meeting.attendance.filter((a) => a.occurrenceStart.getTime() === key);

  const recordings = await prisma.meetingRecording.findMany({
    where: { scheduledMeetingId: meeting.id, occurrenceStart: occurrence.originalStart },
    select: { id: true, status: true },
  });

  const typeLabel =
    meeting.meetingType === "Other"
      ? meeting.meetingTypeLabel ?? "Meeting"
      : (meeting.meetingType ?? "Meeting");

  return {
    meetingId: meeting.id,
    title: meeting.title,
    status: meeting.status,
    startsAt: meeting.selectedAt ? occurrence.start.toISOString() : null,
    durationMinutes: meeting.durationMinutes,
    meetingUrl: meeting.meetingUrl,
    recurrenceRule: meeting.recurrenceRule,
    meetingType: meeting.meetingType,
    typeLabel,
    isCoreMeeting: meeting.isCoreMeeting,
    attendanceMode: meeting.attendanceMode,
    projectId: meeting.projectId,
    organizerName: fullName(meeting.organizer),
    notePageId: noteForOccurrence(meeting.notePages, occurrence.originalStart)?.id ?? null,
    transcriptAvailable: recordings.some((r) => r.status === "Done"),
    recordingIds: recordings.map((r) => r.id),
    canManage,
    roster: roster.map((a) => ({
      userId: a.userId,
      name: fullName(a.user) || a.user.daliEmail || a.userId,
      present: a.present,
      checkedInAt: a.markedAt?.toISOString() ?? null,
    })),
  };
}
