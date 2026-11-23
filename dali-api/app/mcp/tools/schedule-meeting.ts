// MCP `schedule_meeting` — create a ScheduledMeeting on behalf of the
// authenticated user. Supports Group scope, meetingType, project meetings,
// Core meetings, a note notebook, and SelfCheckIn attendance. Mirrors the web
// api.scheduled-meetings.ts POST. Requires the `mcp:write` scope.

import { createScheduledMeeting, type ScheduledMeetingScope } from "~/calendar/lib/scheduled-meeting.server";
import { isCore, canViewForms, isLabMember } from "~/lib/roles";
import { isCoreGroup } from "~/lib/groups.server";
import { notebookChoiceSchema } from "~/calendar/lib/notebook-choice";
import { assertMeetingRoomsFree } from "~/rooms/lib/rooms.server";

export const SCHEDULE_MEETING_TOOL = {
  name: "schedule_meeting",
  description:
    "Create a meeting for a Group or an explicit user list. Without startTime it stays in 'Searching' state. Notifies participants in app and pushes to Google Calendar when the organizer has a linked calendar.",
  inputSchema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "Meeting title.",
      },
      durationMinutes: {
        type: "integer",
        minimum: 5,
        maximum: 480,
        description: "Duration in minutes.",
      },
      scopeType: {
        type: "string",
        enum: ["UserList", "Group", "None"],
        description: "UserList (default) uses participantUserIds, Group uses groupId, None invites no one (org-wide).",
      },
      participantUserIds: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        description: "User IDs to invite. Required for UserList. Find IDs with `list_members`.",
      },
      groupId: {
        type: "string",
        minLength: 1,
        description: "GroupDefinition.id. Required for Group. See `list_groups`.",
      },
      startTime: {
        type: "string",
        format: "date-time",
        description: "ISO 8601 start. Omit to leave the meeting unscheduled.",
      },
      recurrenceRule: {
        type: "string",
        maxLength: 500,
        description: "RFC 5545 RRULE.",
      },
      roomIds: {
        type: "array",
        items: { type: "string", minLength: 1 },
        maxItems: 10,
        description: "Room ids from `list_rooms`. Requires startTime. Every room must be free for every occurrence.",
      },
      organizerCalendarLinkId: {
        type: "string",
        minLength: 1,
        description: "UserCalendarLink.id from `list_my_calendar_links`. Pushes the meeting to that calendar and sends Gmail invites.",
      },
      organizerCalendarId: {
        type: "string",
        minLength: 1,
        maxLength: 320,
        description: "Calendar within the linked account. Default: its primary calendar.",
      },
      meetingType: {
        type: "string",
        enum: ["Team", "Partner", "Other"],
        description: "Team and Partner need projectId and file a note in that project. Other files a general note. Omit for no note.",
      },
      meetingTypeLabel: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        description: "Label for the type. Required for Other.",
      },
      projectId: {
        type: "string",
        minLength: 1,
        description: "Project.id. Required for Team and Partner.",
      },
      notebook: {
        type: "object",
        description: "Where the note files: { existingId } or { title, templatePageId? } to create one. Default if omitted.",
        properties: {
          existingId: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1, maxLength: 200 },
          templatePageId: { type: ["string", "null"], minLength: 1 },
        },
        additionalProperties: false,
      },
      attendanceMode: {
        type: "string",
        enum: ["Roster", "SelfCheckIn"],
        description: "Roster (default): organizer or Core marks attendees. SelfCheckIn: attendees check in by QR; Core or Instructor only.",
      },
      isCoreMeeting: {
        type: "boolean",
        description: "Legacy. Files a project-less note in Core's Meetings folder. Only applies to Core callers.",
      },
      addMeet: {
        type: "boolean",
        description: "Attach a Google Meet link. Needs organizerCalendarLinkId; ignored otherwise.",
      },
      guestEmails: {
        type: "array",
        items: { type: "string" },
        description: "Email addresses of people with no DALI profile. Invited through the Google event, so needs organizerCalendarLinkId and startTime.",
      },
    },
    required: ["title", "durationMinutes"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  title: string;
  durationMinutes: number;
  scopeType?: "UserList" | "Group" | "None";
  participantUserIds?: string[];
  groupId?: string;
  startTime?: string;
  recurrenceRule?: string;
  roomIds?: string[];
  organizerCalendarLinkId?: string;
  organizerCalendarId?: string;
  meetingType?: "Team" | "Partner" | "Other";
  meetingTypeLabel?: string;
  projectId?: string;
  notebook?: { existingId: string } | { title: string; templatePageId?: string | null };
  attendanceMode?: "Roster" | "SelfCheckIn";
  isCoreMeeting?: boolean;
  addMeet?: boolean;
  guestEmails?: string[];
};

export class ScheduleMeetingError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ScheduleMeetingError";
  }
}

export async function runScheduleMeeting(
  user: { id: string; daliEmail: string | null; dartmouthEmail: string | null },
  input: Input,
) {
  const organizerEmail = user.daliEmail ?? user.dartmouthEmail;
  if (!organizerEmail) {
    throw new ScheduleMeetingError("Organizer has no daliEmail or dartmouthEmail on file");
  }

  // Validate scope + required fields
  const scopeType = input.scopeType ?? "UserList";
  if (scopeType === "UserList" && (!input.participantUserIds || input.participantUserIds.length === 0)) {
    throw new ScheduleMeetingError("participantUserIds is required when scopeType is UserList");
  }
  if (scopeType === "Group" && !input.groupId) {
    throw new ScheduleMeetingError("groupId is required when scopeType is Group");
  }
  if (input.meetingType === "Other" && !input.meetingTypeLabel) {
    throw new ScheduleMeetingError("meetingTypeLabel is required when meetingType is Other");
  }
  if ((input.meetingType === "Team" || input.meetingType === "Partner") && !input.projectId) {
    throw new ScheduleMeetingError("projectId is required for Team and Partner meetings");
  }
  if (input.meetingType === "Other" && input.projectId) {
    throw new ScheduleMeetingError("General meetings cannot be attached to a project");
  }
  const notebook = input.notebook === undefined ? undefined : notebookChoiceSchema.safeParse(input.notebook);
  if (notebook && !notebook.success) {
    throw new ScheduleMeetingError("notebook must be { existingId } or { title, templatePageId? }");
  }

  // SelfCheckIn requires Core / Instructor (mirrors canViewForms)
  if (input.attendanceMode === "SelfCheckIn" && !(await canViewForms(user.id))) {
    throw new ScheduleMeetingError("SelfCheckIn attendance mode requires Core or Instructor role");
  }

  // isCoreMeeting: only sticks if caller is Core (or if the invited group is Core)
  let resolvedIsCore = false;
  if (input.isCoreMeeting) {
    const callerIsCore = await isCore(user.id);
    const groupIsCore = scopeType === "Group" && input.groupId
      ? await isCoreGroup(input.groupId)
      : false;
    resolvedIsCore = callerIsCore || groupIsCore;
  }

  const roomIds = [...new Set(input.roomIds ?? [])];
  if (roomIds.length) {
    if (!input.startTime) throw new ScheduleMeetingError("roomIds requires startTime");
    const selectedAt = new Date(input.startTime);
    if (Number.isNaN(selectedAt.getTime())) throw new ScheduleMeetingError("startTime is not a valid time");
    if (!(await isLabMember(user.id))) throw new ScheduleMeetingError("Only current lab members can book rooms");
    const free = await assertMeetingRoomsFree({
      roomIds,
      selectedAt,
      durationMinutes: input.durationMinutes,
      recurrenceRule: input.recurrenceRule ?? null,
    });
    if (!free.ok) throw new ScheduleMeetingError(free.error);
  }

  let scope: ScheduledMeetingScope;
  if (scopeType === "Group" && input.groupId) {
    scope = { type: "Group", groupId: input.groupId };
  } else if (scopeType === "UserList" && input.participantUserIds) {
    scope = { type: "UserList", participantUserIds: input.participantUserIds };
  } else {
    scope = { type: "None" };
  }

  const result = await createScheduledMeeting({
    organizerId: user.id,
    organizerEmail,
    title: input.title,
    durationMinutes: input.durationMinutes,
    scope,
    startTime: input.startTime,
    recurrenceRule: input.recurrenceRule,
    roomIds,
    organizerCalendarLinkId: input.organizerCalendarLinkId,
    organizerCalendarId: input.organizerCalendarId,
    meetingType: input.meetingType,
    meetingTypeLabel: input.meetingTypeLabel,
    projectId: input.projectId,
    notebook: notebook?.data,
    attendanceMode: input.attendanceMode,
    isCoreMeeting: resolvedIsCore,
    addMeet: input.addMeet,
    guestEmails: input.guestEmails,
  });

  if (!result.ok) {
    throw new ScheduleMeetingError(result.error);
  }

  return {
    meetingId: result.meeting.id,
    title: result.meeting.title,
    status: result.meeting.status,
    startsAt: result.meeting.selectedAt?.toISOString() ?? null,
    durationMinutes: result.meeting.durationMinutes,
    participantUserIds: result.meeting.participantUserIds,
    externalEventId: result.meeting.externalEventId,
    meetingUrl: result.meeting.meetingUrl,
    notePageId: result.notePageId,
    notifiedCount: result.notifiedCount,
    gcalError: result.gcalError,
  };
}
