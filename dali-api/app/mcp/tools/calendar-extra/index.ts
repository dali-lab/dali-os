// MCP tool area: calendar-extra. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool } from "../../registry";

import {
  LIST_SCHEDULED_MEETINGS_DEF,
  runListScheduledMeetings,
} from "./list-scheduled-meetings";
import {
  GET_MEETING_ATTENDANCE_DEF,
  runGetMeetingAttendance,
} from "./get-meeting-attendance";
import {
  GET_GROUP_AVAILABILITY_DEF,
  runGetGroupAvailability,
} from "./get-group-availability";
import {
  GET_GOOGLE_CALENDAR_BUSY_DEF,
  runGetGoogleCalendarBusy,
} from "./get-google-calendar-busy";
import {
  CHECK_IN_TO_MEETING_DEF,
  runCheckInToMeeting,
} from "./check-in-to-meeting";
import {
  UPDATE_PROFILE_DEF,
  runUpdateProfile,
} from "./update-profile";

export const CALENDAR_TOOLS: McpTool[] = [
  {
    def: LIST_SCHEDULED_MEETINGS_DEF,
    run: (ctx, args) =>
      runListScheduledMeetings(ctx.user.id, args as { status?: "Searching" | "Confirmed" | "Cancelled"; role?: "organizer" | "participant" | "any"; limit?: number }),
  },
  {
    def: GET_MEETING_ATTENDANCE_DEF,
    run: (ctx, args) =>
      runGetMeetingAttendance(ctx.user.id, args as { meetingId: string }),
  },
  {
    def: GET_GROUP_AVAILABILITY_DEF,
    run: (_ctx, args) =>
      runGetGroupAvailability(args as { userIds: string[]; weekStartIso: string; weekEndIso: string; durationMinutes: number; timezone: string }),
  },
  {
    def: GET_GOOGLE_CALENDAR_BUSY_DEF,
    run: (ctx, args) =>
      runGetGoogleCalendarBusy(ctx.user.id, args as { start: string; end: string }),
  },
  {
    def: CHECK_IN_TO_MEETING_DEF,
    run: (ctx, args) =>
      runCheckInToMeeting(ctx.user.id, args as { meetingId: string }),
  },
  {
    def: UPDATE_PROFILE_DEF,
    run: (ctx, args) =>
      runUpdateProfile(ctx.user.id, args as { firstName?: string; lastName?: string; pronouns?: string; handle?: string; timezone?: string; photoUrl?: string }),
  },
];
