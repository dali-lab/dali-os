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
import { FIND_FREE_TIMES_DEF, runFindFreeTimes } from "./find-free-times";
import { CHECK_IN_DEF, runCheckIn } from "./check-in";
import {
  OPTIMIZE_GROUP_MEETINGS_DEF,
  runOptimizeGroupMeetings,
} from "./optimize-group-meetings";
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
  GET_MEETING_TRANSCRIPT_DEF,
  runGetMeetingTranscript,
} from "./get-meeting-transcript";
import {
  ENHANCE_MEETING_NOTES_DEF,
  runEnhanceMeetingNotes,
} from "./enhance-meeting-notes";
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
  MANAGE_CALENDAR_LINK_DEF,
  runManageCalendarLink,
} from "./manage-calendar-link";
import {
  LIST_ROOMS_DEF,
  GET_ROOM_SCHEDULE_DEF,
  BOOK_ROOM_DEF,
  CANCEL_ROOM_BOOKING_DEF,
  runListRooms,
  runGetRoomSchedule,
  runBookRoom,
  runCancelRoomBooking,
} from "./rooms";

export const CALENDAR_TOOLS: McpTool[] = [
  {
    def: LIST_SCHEDULED_MEETINGS_DEF,
    run: (ctx, args) =>
      runListScheduledMeetings(ctx.user.id, args as { status?: "Searching" | "Confirmed" | "Cancelled"; role?: "organizer" | "participant" | "any"; limit?: number; cursor?: string }),
  },
  {
    def: GET_MEETING_ATTENDANCE_DEF,
    run: (ctx, args) =>
      runGetMeetingAttendance(ctx.user.id, args as { meetingId: string }),
  },
  {
    def: FIND_FREE_TIMES_DEF,
    run: (ctx, args) => runFindFreeTimes(ctx.user.id, args as Parameters<typeof runFindFreeTimes>[1]),
  },
  {
    def: OPTIMIZE_GROUP_MEETINGS_DEF,
    run: (_ctx, args) =>
      runOptimizeGroupMeetings(args as Parameters<typeof runOptimizeGroupMeetings>[0]),
  },
  {
    def: CHECK_IN_DEF,
    run: (ctx, args) => runCheckIn(ctx, args as Parameters<typeof runCheckIn>[1]),
  },
  {
    def: UPDATE_PROFILE_DEF,
    run: (ctx, args) =>
      runUpdateProfile(ctx.user.id, args as Parameters<typeof runUpdateProfile>[1]),
  },
  {
    def: MARK_MEETING_ATTENDANCE_DEF,
    run: (ctx, args) =>
      runMarkMeetingAttendance(ctx.user.id, args as Parameters<typeof runMarkMeetingAttendance>[1]),
  },
  {
    def: GET_MEETING_DEF,
    run: (ctx, args) =>
      runGetMeeting(ctx.user.id, args as Parameters<typeof runGetMeeting>[1]),
  },
  {
    def: GET_MEETING_TRANSCRIPT_DEF,
    run: (ctx, args) =>
      runGetMeetingTranscript(ctx.user.id, args as Parameters<typeof runGetMeetingTranscript>[1]),
  },
  {
    def: ENHANCE_MEETING_NOTES_DEF,
    run: (ctx, args) => runEnhanceMeetingNotes(ctx, args as Parameters<typeof runEnhanceMeetingNotes>[1]),
  },
  {
    def: SEARCH_CALENDAR_DEF,
    run: (ctx, args) =>
      runSearchCalendar(ctx.user.id, args as Parameters<typeof runSearchCalendar>[1]),
  },
  {
    def: MANAGE_CLASS_DEF,
    run: (ctx, args) =>
      runManageClass(ctx.user.id, args as Parameters<typeof runManageClass>[1]),
  },
  {
    def: SEARCH_TIMETABLE_COURSES_DEF,
    run: (ctx, args) =>
      runSearchTimetableCourses(ctx.user.id, args as Parameters<typeof runSearchTimetableCourses>[1]),
  },
  {
    def: MANAGE_CALENDAR_LINK_DEF,
    run: (ctx, args) =>
      runManageCalendarLink(ctx.user.id, args as Parameters<typeof runManageCalendarLink>[1]),
  },
  {
    def: LIST_ROOMS_DEF,
    run: (ctx, args) =>
      runListRooms(ctx.user.id, args as Parameters<typeof runListRooms>[1]),
  },
  {
    def: GET_ROOM_SCHEDULE_DEF,
    run: (ctx, args) =>
      runGetRoomSchedule(ctx.user.id, args as Parameters<typeof runGetRoomSchedule>[1]),
  },
  {
    def: BOOK_ROOM_DEF,
    run: (ctx, args) =>
      runBookRoom(ctx.user.id, args as Parameters<typeof runBookRoom>[1]),
  },
  {
    def: CANCEL_ROOM_BOOKING_DEF,
    run: (ctx, args) =>
      runCancelRoomBooking(ctx.user.id, args as Parameters<typeof runCancelRoomBooking>[1]),
  },
];
