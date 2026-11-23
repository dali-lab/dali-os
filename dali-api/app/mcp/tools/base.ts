// MCP tool area: base — the original member, task, page and project tools.

import type { McpCtx, McpTool } from "../registry";

import { WHOAMI_TOOL, runWhoami } from "./whoami";
import { LIST_MY_NOTIFICATIONS_TOOL, runListMyNotifications } from "./list-my-notifications";
import { LIST_MY_UPCOMING_MEETINGS_TOOL, runListMyUpcomingMeetings } from "./list-my-upcoming-meetings";
import { GET_MEMBER_PROFILE_TOOL, runGetMemberProfile } from "./get-member-profile";
import { SCHEDULE_MEETING_TOOL, runScheduleMeeting } from "./schedule-meeting";
import { LIST_MY_CALENDAR_LINKS_TOOL, runListMyCalendarLinks } from "./list-my-calendar-links";
import { MARK_NOTIFICATION_READ_TOOL, runMarkNotificationRead } from "./mark-notification-read";
import { RSVP_TO_NOTIFICATION_TOOL, runRsvpToNotification } from "./rsvp-to-notification";
import {
  LIST_NOTIFICATION_PREFERENCES_TOOL,
  runListNotificationPreferences,
  SET_NOTIFICATION_PREFERENCE_TOOL,
  runSetNotificationPreference,
} from "./notification-preferences";
import { CANCEL_MEETING_TOOL, runCancelMeeting } from "./cancel-meeting";
import { LIST_GROUPS_TOOL, runListGroups } from "./list-groups";
import { LIST_PROJECTS_TOOL, runListProjects } from "./list-projects";
import { GET_PROJECT_TOOL, runGetProject } from "./get-project";
import { LIST_TERMS_TOOL, runListTerms } from "./list-terms";
import { LIST_MY_TASKS_TOOL, runListMyTasks } from "./list-my-tasks";
import { GET_TASK_TOOL, runGetTask } from "./get-task";
import { CREATE_PROJECT_TOOL, runCreateProject } from "./create-project";
import { LIST_SPRINTS_TOOL, runListSprints } from "./list-sprints";
import { LIST_EPICS_TOOL, runListEpics } from "./list-epics";
import { LIST_PROJECT_PAGES_TOOL, runListProjectPages } from "./list-project-pages";
import { READ_PAGE_TOOL, runReadPage } from "./read-page";
import { CREATE_PAGE_TOOL, runCreatePage } from "./create-page";
import { SET_PAGE_CONTENT_TOOL, runSetPageContent } from "./set-page-content";
import { LIST_PROJECT_FILES_TOOL, runListProjectFiles } from "./list-project-files";
import { UPLOAD_PROJECT_FILE_TOOL, runUploadProjectFile } from "./upload-project-file";
import {
  LIST_MY_TIME_ENTRIES_TOOL,
  runListMyTimeEntries,
} from "./time-entries";
import {
  UPDATE_PROJECT_SHOWCASE_TOOL,
  runUpdateProjectShowcase,
} from "./project-showcase";
import {
  GET_STAFFING_BOARD_TOOL,
  runGetStaffingBoard,
} from "./staffing";
import { LIST_DOCUMENT_SHARING_TOOL, runListDocumentSharing } from "./document-curation";
import { LIST_FILE_SHARES_TOOL, runListFileShares } from "./file-sharing";
import { LIST_PAGE_SHARES_TOOL, runListPageShares } from "./page-sharing";

type CallerTool = (callerId: string, args: never, ctx: McpCtx) => Promise<unknown>;

function asCaller(def: McpTool["def"], run: CallerTool): McpTool {
  return { def, run: (ctx, args) => run(ctx.user.id, args as never, ctx) };
}

export const BASE_TOOLS: McpTool[] = [
  { def: WHOAMI_TOOL, run: (ctx, args) => runWhoami(ctx.user, args) },
  { def: LIST_MY_NOTIFICATIONS_TOOL, run: (ctx, args) => runListMyNotifications(ctx.user.id, args) },
  { def: LIST_MY_UPCOMING_MEETINGS_TOOL, run: (ctx, args) => runListMyUpcomingMeetings(ctx.user.id, args) },
  asCaller(GET_MEMBER_PROFILE_TOOL, runGetMemberProfile),
  {
    def: SCHEDULE_MEETING_TOOL,
    run: (ctx, args) => runScheduleMeeting(ctx.user, args as Parameters<typeof runScheduleMeeting>[1]),
  },
  { def: LIST_MY_CALENDAR_LINKS_TOOL, run: (ctx) => runListMyCalendarLinks(ctx.user.id) },
  asCaller(MARK_NOTIFICATION_READ_TOOL, runMarkNotificationRead),
  {
    def: RSVP_TO_NOTIFICATION_TOOL,
    run: (ctx, args) => runRsvpToNotification(ctx.user, args as Parameters<typeof runRsvpToNotification>[1]),
  },
  { def: LIST_NOTIFICATION_PREFERENCES_TOOL, run: (ctx) => runListNotificationPreferences(ctx.user.id) },
  asCaller(SET_NOTIFICATION_PREFERENCE_TOOL, runSetNotificationPreference),
  asCaller(CANCEL_MEETING_TOOL, runCancelMeeting),
  asCaller(LIST_GROUPS_TOOL, runListGroups),
  asCaller(LIST_PROJECTS_TOOL, runListProjects),
  asCaller(GET_PROJECT_TOOL, runGetProject),
  { def: LIST_TERMS_TOOL, run: () => runListTerms() },
  asCaller(LIST_MY_TASKS_TOOL, runListMyTasks),
  asCaller(GET_TASK_TOOL, runGetTask),
  asCaller(CREATE_PROJECT_TOOL, runCreateProject),
  asCaller(LIST_SPRINTS_TOOL, runListSprints),
  asCaller(LIST_EPICS_TOOL, runListEpics),
  asCaller(LIST_PROJECT_PAGES_TOOL, runListProjectPages),
  asCaller(READ_PAGE_TOOL, runReadPage),
  asCaller(CREATE_PAGE_TOOL, runCreatePage),
  asCaller(SET_PAGE_CONTENT_TOOL, runSetPageContent),
  asCaller(LIST_PROJECT_FILES_TOOL, runListProjectFiles),
  asCaller(UPLOAD_PROJECT_FILE_TOOL, runUploadProjectFile),
  asCaller(LIST_MY_TIME_ENTRIES_TOOL, runListMyTimeEntries),
  asCaller(UPDATE_PROJECT_SHOWCASE_TOOL, runUpdateProjectShowcase),
  asCaller(GET_STAFFING_BOARD_TOOL, runGetStaffingBoard),
  asCaller(LIST_DOCUMENT_SHARING_TOOL, runListDocumentSharing),
  asCaller(LIST_FILE_SHARES_TOOL, runListFileShares),
  asCaller(LIST_PAGE_SHARES_TOOL, runListPageShares),
];
