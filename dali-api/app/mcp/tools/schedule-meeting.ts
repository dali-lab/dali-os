// MCP `schedule_meeting` — create a ScheduledMeeting on behalf of the
// authenticated user with an explicit participant list. Mirrors the Calendar
// "Schedule Meeting" button. Requires the `mcp:write` scope.
//
// Group and "None" (org-wide) scopes are deliberately not exposed via MCP —
// pair this with `search_directory` to resolve participant userIds.

import { createScheduledMeeting } from "~/lib/scheduled-meeting";

export const SCHEDULE_MEETING_TOOL = {
  name: "schedule_meeting",
  description:
    "Create a meeting with an explicit list of DALI member participants. Optionally schedule it for a specific start time; otherwise the meeting is created in 'Searching' state. Sends in-app MeetingInvite notifications to participants, and pushes to Google Calendar when the organizer has a linked calendar.",
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
      participantUserIds: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        description:
          "DALI member User IDs to invite. Use `search_directory` to look up IDs by name.",
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
    },
    required: ["title", "durationMinutes", "participantUserIds"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  title: string;
  durationMinutes: number;
  participantUserIds: string[];
  startTime?: string;
  recurrenceRule?: string;
  organizerCalendarLinkId?: string;
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

  const result = await createScheduledMeeting({
    organizerId: user.id,
    organizerEmail,
    title: input.title,
    durationMinutes: input.durationMinutes,
    scope: { type: "UserList", participantUserIds: input.participantUserIds },
    startTime: input.startTime,
    recurrenceRule: input.recurrenceRule,
    organizerCalendarLinkId: input.organizerCalendarLinkId,
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
    notifiedCount: result.notifiedCount,
    gcalError: result.gcalError,
  };
}
