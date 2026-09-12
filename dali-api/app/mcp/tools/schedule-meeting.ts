// MCP `schedule_meeting` — create a ScheduledMeeting on behalf of the
// authenticated user. Supports Group scope, meetingType, project meetings,
// Core meetings, note location, and SelfCheckIn attendance. Mirrors the web
// api.scheduled-meetings.ts POST. Requires the `mcp:write` scope.

import { createScheduledMeeting, type ScheduledMeetingScope } from "~/lib/scheduled-meeting";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles, isCore, canViewForms } from "~/lib/roles";
import { isCoreGroup } from "~/lib/groups";

export const SCHEDULE_MEETING_TOOL = {
  name: "schedule_meeting",
  description:
    "Create a meeting. Supports inviting a DALI Group or an explicit user list. Optionally schedule it for a specific start time; otherwise the meeting is created in 'Searching' state. Sends in-app MeetingInvite notifications to participants, and pushes to Google Calendar when the organizer has a linked calendar.",
  inputSchema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "Meeting title (1–200 chars).",
      },
      durationMinutes: {
        type: "integer",
        minimum: 5,
        maximum: 480,
        description: "Duration in minutes (5–480).",
      },
      scopeType: {
        type: "string",
        enum: ["UserList", "Group", "None"],
        description:
          "How to resolve participants. 'UserList' (default) uses participantUserIds; 'Group' resolves a GroupDefinition; 'None' creates the meeting with no participants (org-wide).",
      },
      participantUserIds: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        description:
          "DALI member User IDs to invite — required when scopeType is 'UserList'. Use `search_directory` to look up IDs by name.",
      },
      groupId: {
        type: "string",
        minLength: 1,
        description:
          "GroupDefinition.id — required when scopeType is 'Group'. Use `list_groups` to find available groups.",
      },
      startTime: {
        type: "string",
        format: "date-time",
        description:
          "Optional ISO 8601 start time. If omitted, the meeting is created in 'Searching' state with no confirmed time.",
      },
      recurrenceRule: {
        type: "string",
        maxLength: 500,
        description: "Optional RFC 5545 RRULE for recurring meetings.",
      },
      organizerCalendarLinkId: {
        type: "string",
        minLength: 1,
        description:
          "Optional UserCalendarLink ID. When provided (and enabled), the meeting is pushed to that external calendar and Gmail invites are sent. Use `list_my_calendar_links` to discover available IDs.",
      },
      organizerCalendarId: {
        type: "string",
        minLength: 1,
        maxLength: 320,
        description:
          "Optional calendar ID within the linked account. Omitted = the account's primary calendar.",
      },
      meetingType: {
        type: "string",
        enum: ["Team", "Partner", "Other"],
        description:
          "'Team' or 'Partner' require projectId and create a meeting note in that project. 'Other' creates a general meeting note (no project). Omit for meetings without notes.",
      },
      meetingTypeLabel: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        description: "Display label for the meeting type — required when meetingType is 'Other'.",
      },
      projectId: {
        type: "string",
        minLength: 1,
        description: "Project.id — required for 'Team' and 'Partner' meeting types.",
      },
      noteLocation: {
        type: "object",
        description:
          "Where to file the meeting note for 'Other' meetings. Defaults to Lab root when omitted.",
        properties: {
          workspaceType: { type: "string", enum: ["Lab", "Project"] },
          workspaceId: { type: "string", nullable: true },
          parentPageId: { type: "string", nullable: true },
        },
        required: ["workspaceType", "workspaceId", "parentPageId"],
        additionalProperties: false,
      },
      attendanceMode: {
        type: "string",
        enum: ["Roster", "SelfCheckIn"],
        description:
          "'Roster' (default): organizer/Core mark attendees. 'SelfCheckIn': attendees self-check-in via QR — Core/Instructor only.",
      },
      isCoreMeeting: {
        type: "boolean",
        description:
          "Mark as a Core meeting (Core-only). Only takes effect when the caller is Core. Defaults to false.",
      },
      addMeet: {
        type: "boolean",
        description:
          "Attach a Google Meet link. Requires the google-meet feature and an organizerCalendarLinkId (the link is minted on that calendar); ignored otherwise.",
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
  organizerCalendarLinkId?: string;
  organizerCalendarId?: string;
  meetingType?: "Team" | "Partner" | "Other";
  meetingTypeLabel?: string;
  projectId?: string;
  noteLocation?: {
    workspaceType: "Lab" | "Project";
    workspaceId: string | null;
    parentPageId: string | null;
  };
  attendanceMode?: "Roster" | "SelfCheckIn";
  isCoreMeeting?: boolean;
  addMeet?: boolean;
};

export class ScheduleMeetingError extends Error {
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

  const roles = await getUserRoles(user.id);

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

  let scope: ScheduledMeetingScope;
  if (scopeType === "Group" && input.groupId) {
    scope = { type: "Group", groupId: input.groupId };
  } else if (scopeType === "UserList" && input.participantUserIds) {
    scope = { type: "UserList", participantUserIds: input.participantUserIds };
  } else {
    scope = { type: "None" };
  }

  const addMeet =
    !!input.addMeet &&
    (await isFeatureEnabled("google-meet", user.id, roles));

  const result = await createScheduledMeeting({
    organizerId: user.id,
    organizerEmail,
    title: input.title,
    durationMinutes: input.durationMinutes,
    scope,
    startTime: input.startTime,
    recurrenceRule: input.recurrenceRule,
    organizerCalendarLinkId: input.organizerCalendarLinkId,
    organizerCalendarId: input.organizerCalendarId,
    meetingType: input.meetingType,
    meetingTypeLabel: input.meetingTypeLabel,
    projectId: input.projectId,
    noteLocation: input.noteLocation,
    attendanceMode: input.attendanceMode,
    isCoreMeeting: resolvedIsCore,
    addMeet,
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
