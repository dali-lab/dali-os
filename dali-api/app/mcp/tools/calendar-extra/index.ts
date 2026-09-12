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
import {
  MARK_MEETING_ATTENDANCE_DEF,
  runMarkMeetingAttendance,
} from "./mark-meeting-attendance";
import {
  GET_MEETING_DEF,
  runGetMeeting,
} from "./get-meeting";
import {
  SEARCH_CALENDAR_DEF,
  runSearchCalendar,
} from "./search-calendar";
import {
  MANAGE_CLASS_DEF,
  runManageClass,
} from "./manage-class";
import {
  SEARCH_TIMETABLE_COURSES_DEF,
  runSearchTimetableCourses,
} from "./search-timetable-courses";
import {
  SCAN_ATTENDEE_DEF,
  runScanAttendee,
} from "./scan-attendee";
import {
  MANAGE_CALENDAR_LINK_DEF,
  runManageCalendarLink,
} from "./manage-calendar-link";

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
  {
    def: MARK_MEETING_ATTENDANCE_DEF,
    run: (ctx, args) =>
      runMarkMeetingAttendance(ctx.user.id, args as { meetingId: string; userId: string; present: boolean }),
  },
  {
    def: GET_MEETING_DEF,
    run: (ctx, args) =>
      runGetMeeting(ctx.user.id, args as { meetingId: string }),
  },
  {
    def: SEARCH_CALENDAR_DEF,
    run: (ctx, args) =>
      runSearchCalendar(ctx.user.id, args as { q: string; scope?: "near" | "all"; rangeStart?: string; rangeEnd?: string }),
  },
  {
    def: MANAGE_CLASS_DEF,
    run: (ctx, args) =>
      runManageClass(ctx.user.id, args as Parameters<typeof runManageClass>[1]),
  },
  {
    def: SEARCH_TIMETABLE_COURSES_DEF,
    run: (ctx, args) =>
      runSearchTimetableCourses(ctx.user.id, args as { termId: string; q: string }),
  },
  {
    def: SCAN_ATTENDEE_DEF,
    run: (ctx, args) =>
      runScanAttendee(ctx.user.id, args as { meetingId: string; memberToken: string }),
  },
  {
    def: MANAGE_CALENDAR_LINK_DEF,
    run: (ctx, args) =>
      runManageCalendarLink(ctx.user.id, args as Parameters<typeof runManageCalendarLink>[1]),
  },
];
