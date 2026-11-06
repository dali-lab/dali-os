import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const runs: Record<string, ReturnType<typeof vi.fn>> = {};
  const def = (name: string) => ({
    name,
    description: name,
    requiredScope: "mcp:read" as const,
    inputSchema: { type: "object" },
  });
  const run = (fn: string) => (runs[fn] ??= vi.fn());
  return { runs, def, run };
});

vi.mock("../whoami", () => ({ WHOAMI_TOOL: h.def("whoami"), runWhoami: h.run("runWhoami") }));
vi.mock("../list-my-notifications", () => ({
  LIST_MY_NOTIFICATIONS_TOOL: h.def("list_my_notifications"),
  runListMyNotifications: h.run("runListMyNotifications"),
}));
vi.mock("../list-my-upcoming-meetings", () => ({
  LIST_MY_UPCOMING_MEETINGS_TOOL: h.def("list_my_upcoming_meetings"),
  runListMyUpcomingMeetings: h.run("runListMyUpcomingMeetings"),
}));
vi.mock("../find-mutual-freebusy", () => ({
  FIND_MUTUAL_FREEBUSY_TOOL: h.def("find_mutual_freebusy"),
  runFindMutualFreebusy: h.run("runFindMutualFreebusy"),
}));
vi.mock("../search-directory", () => ({
  SEARCH_DIRECTORY_TOOL: h.def("search_directory"),
  runSearchDirectory: h.run("runSearchDirectory"),
}));
vi.mock("../get-member-profile", () => ({
  GET_MEMBER_PROFILE_TOOL: h.def("get_member_profile"),
  runGetMemberProfile: h.run("runGetMemberProfile"),
}));
vi.mock("../schedule-meeting", () => ({
  SCHEDULE_MEETING_TOOL: h.def("schedule_meeting"),
  runScheduleMeeting: h.run("runScheduleMeeting"),
}));
vi.mock("../list-my-calendar-links", () => ({
  LIST_MY_CALENDAR_LINKS_TOOL: h.def("list_my_calendar_links"),
  runListMyCalendarLinks: h.run("runListMyCalendarLinks"),
}));
vi.mock("../mark-notification-read", () => ({
  MARK_NOTIFICATION_READ_TOOL: h.def("mark_notification_read"),
  runMarkNotificationRead: h.run("runMarkNotificationRead"),
}));
vi.mock("../rsvp-to-notification", () => ({
  RSVP_TO_NOTIFICATION_TOOL: h.def("rsvp_to_notification"),
  runRsvpToNotification: h.run("runRsvpToNotification"),
}));
vi.mock("../notification-preferences", () => ({
  LIST_NOTIFICATION_PREFERENCES_TOOL: h.def("list_notification_preferences"),
  runListNotificationPreferences: h.run("runListNotificationPreferences"),
  SET_NOTIFICATION_PREFERENCE_TOOL: h.def("set_notification_preference"),
  runSetNotificationPreference: h.run("runSetNotificationPreference"),
}));
vi.mock("../cancel-meeting", () => ({
  CANCEL_MEETING_TOOL: h.def("cancel_meeting"),
  runCancelMeeting: h.run("runCancelMeeting"),
}));
vi.mock("../list-groups", () => ({ LIST_GROUPS_TOOL: h.def("list_groups"), runListGroups: h.run("runListGroups") }));
vi.mock("../list-my-projects", () => ({
  LIST_MY_PROJECTS_TOOL: h.def("list_my_projects"),
  runListMyProjects: h.run("runListMyProjects"),
}));
vi.mock("../list-projects", () => ({
  LIST_PROJECTS_TOOL: h.def("list_projects"),
  runListProjects: h.run("runListProjects"),
}));
vi.mock("../list-terms", () => ({ LIST_TERMS_TOOL: h.def("list_terms"), runListTerms: h.run("runListTerms") }));
vi.mock("../get-project-overview", () => ({
  GET_PROJECT_OVERVIEW_TOOL: h.def("get_project_overview"),
  runGetProjectOverview: h.run("runGetProjectOverview"),
}));
vi.mock("../list-my-tasks", () => ({
  LIST_MY_TASKS_TOOL: h.def("list_my_tasks"),
  runListMyTasks: h.run("runListMyTasks"),
}));
vi.mock("../get-task", () => ({ GET_TASK_TOOL: h.def("get_task"), runGetTask: h.run("runGetTask") }));
vi.mock("../create-project", () => ({
  CREATE_PROJECT_TOOL: h.def("create_project"),
  runCreateProject: h.run("runCreateProject"),
}));
vi.mock("../add-task-comment", () => ({
  ADD_TASK_COMMENT_TOOL: h.def("add_task_comment"),
  runAddTaskComment: h.run("runAddTaskComment"),
}));
vi.mock("../list-sprints", () => ({ LIST_SPRINTS_TOOL: h.def("list_sprints"), runListSprints: h.run("runListSprints") }));
vi.mock("../list-epics", () => ({ LIST_EPICS_TOOL: h.def("list_epics"), runListEpics: h.run("runListEpics") }));
vi.mock("../list-project-pages", () => ({
  LIST_PROJECT_PAGES_TOOL: h.def("list_project_pages"),
  runListProjectPages: h.run("runListProjectPages"),
}));
vi.mock("../read-page", () => ({ READ_PAGE_TOOL: h.def("read_page"), runReadPage: h.run("runReadPage") }));
vi.mock("../create-page", () => ({ CREATE_PAGE_TOOL: h.def("create_page"), runCreatePage: h.run("runCreatePage") }));
vi.mock("../set-page-content", () => ({
  SET_PAGE_CONTENT_TOOL: h.def("set_page_content"),
  runSetPageContent: h.run("runSetPageContent"),
}));
vi.mock("../list-project-files", () => ({
  LIST_PROJECT_FILES_TOOL: h.def("list_project_files"),
  runListProjectFiles: h.run("runListProjectFiles"),
}));
vi.mock("../upload-project-file", () => ({
  UPLOAD_PROJECT_FILE_TOOL: h.def("upload_project_file"),
  runUploadProjectFile: h.run("runUploadProjectFile"),
}));
vi.mock("../time-entries", () => ({
  LIST_MY_ROLES_TOOL: h.def("list_my_roles"),
  runListMyRoles: h.run("runListMyRoles"),
  LIST_MY_TIME_ENTRIES_TOOL: h.def("list_my_time_entries"),
  runListMyTimeEntries: h.run("runListMyTimeEntries"),
}));
vi.mock("../project-settings", () => ({
  GET_PROJECT_SETTINGS_TOOL: h.def("get_project_settings"),
  runGetProjectSettings: h.run("runGetProjectSettings"),
}));
vi.mock("../project-showcase", () => ({
  GET_PROJECT_SHOWCASE_TOOL: h.def("get_project_showcase"),
  runGetProjectShowcase: h.run("runGetProjectShowcase"),
  UPDATE_PROJECT_SHOWCASE_TOOL: h.def("update_project_showcase"),
  runUpdateProjectShowcase: h.run("runUpdateProjectShowcase"),
}));
vi.mock("../staffing", () => ({
  GET_STAFFING_BOARD_TOOL: h.def("get_staffing_board"),
  runGetStaffingBoard: h.run("runGetStaffingBoard"),
  SET_STAFFING_ASSIGNMENT_TOOL: h.def("set_staffing_assignment"),
  runSetStaffingAssignment: h.run("runSetStaffingAssignment"),
  SET_DOMAIN_ELIGIBILITY_TOOL: h.def("set_domain_eligibility"),
  runSetDomainEligibility: h.run("runSetDomainEligibility"),
}));
vi.mock("../document-curation", () => ({
  LIST_DOCUMENT_SHARING_TOOL: h.def("list_document_sharing"),
  runListDocumentSharing: h.run("runListDocumentSharing"),
}));
vi.mock("../file-sharing", () => ({
  LIST_FILE_SHARES_TOOL: h.def("list_file_shares"),
  runListFileShares: h.run("runListFileShares"),
}));

import { BASE_TOOLS } from "../base";
import type { McpCtx } from "../../registry";

const CTX: McpCtx = {
  user: {
    id: "u1",
    daliEmail: "ada@dali.example.edu",
    dartmouthEmail: "ada@example.edu",
    netId: "f00001",
    firstName: "Ada",
    lastName: "Lovelace",
  },
  scopes: ["mcp:read", "mcp:write"],
  request: new Request("http://x/mcp"),
};
const ARGS = { id: "x1" };

type Shape = "caller" | "user" | "args" | "callerOnly" | "userOnly" | "none";

const EXPECTED: [string, string, Shape][] = [
  ["whoami", "runWhoami", "userOnly"],
  ["list_my_notifications", "runListMyNotifications", "caller"],
  ["list_my_upcoming_meetings", "runListMyUpcomingMeetings", "caller"],
  ["find_mutual_freebusy", "runFindMutualFreebusy", "caller"],
  ["search_directory", "runSearchDirectory", "args"],
  ["get_member_profile", "runGetMemberProfile", "caller"],
  ["schedule_meeting", "runScheduleMeeting", "user"],
  ["list_my_calendar_links", "runListMyCalendarLinks", "callerOnly"],
  ["mark_notification_read", "runMarkNotificationRead", "caller"],
  ["rsvp_to_notification", "runRsvpToNotification", "user"],
  ["list_notification_preferences", "runListNotificationPreferences", "callerOnly"],
  ["set_notification_preference", "runSetNotificationPreference", "caller"],
  ["cancel_meeting", "runCancelMeeting", "caller"],
  ["list_groups", "runListGroups", "caller"],
  ["list_my_projects", "runListMyProjects", "caller"],
  ["list_projects", "runListProjects", "caller"],
  ["list_terms", "runListTerms", "none"],
  ["get_project_overview", "runGetProjectOverview", "args"],
  ["list_my_tasks", "runListMyTasks", "caller"],
  ["get_task", "runGetTask", "caller"],
  ["create_project", "runCreateProject", "caller"],
  ["add_task_comment", "runAddTaskComment", "caller"],
  ["list_sprints", "runListSprints", "caller"],
  ["list_epics", "runListEpics", "caller"],
  ["list_project_pages", "runListProjectPages", "caller"],
  ["read_page", "runReadPage", "caller"],
  ["create_page", "runCreatePage", "caller"],
  ["set_page_content", "runSetPageContent", "caller"],
  ["list_project_files", "runListProjectFiles", "caller"],
  ["upload_project_file", "runUploadProjectFile", "caller"],
  ["list_my_roles", "runListMyRoles", "caller"],
  ["list_my_time_entries", "runListMyTimeEntries", "caller"],
  ["get_project_settings", "runGetProjectSettings", "caller"],
  ["get_project_showcase", "runGetProjectShowcase", "caller"],
  ["update_project_showcase", "runUpdateProjectShowcase", "caller"],
  ["get_staffing_board", "runGetStaffingBoard", "caller"],
  ["set_staffing_assignment", "runSetStaffingAssignment", "caller"],
  ["set_domain_eligibility", "runSetDomainEligibility", "caller"],
  ["list_document_sharing", "runListDocumentSharing", "caller"],
  ["list_file_shares", "runListFileShares", "caller"],
];

const EXPECTED_CALL: Record<Shape, unknown[]> = {
  caller: ["u1", ARGS],
  user: [CTX.user, ARGS],
  args: [ARGS],
  callerOnly: ["u1"],
  userOnly: [CTX.user],
  none: [],
};

beforeEach(() => vi.clearAllMocks());

describe("BASE_TOOLS", () => {
  it("serves every original tool once, in the order tools/list has always listed them", () => {
    expect(BASE_TOOLS.map((t) => t.def.name)).toEqual(EXPECTED.map(([name]) => name));
  });

  it("keeps each tool's definition as its module declares it", () => {
    for (const t of BASE_TOOLS) expect(t.def).toEqual(h.def(t.def.name));
  });

  it.each(EXPECTED)("%s calls %s with the %s arguments and returns its result", async (name, fn, shape) => {
    h.runs[fn].mockResolvedValue({ from: fn });
    const tool = BASE_TOOLS.find((t) => t.def.name === name)!;
    await expect(tool.run(CTX, ARGS)).resolves.toEqual({ from: fn });
    expect(h.runs[fn]).toHaveBeenCalledTimes(1);
    expect(h.runs[fn]).toHaveBeenCalledWith(...EXPECTED_CALL[shape]);
  });

  it("lets a runner's error reach the dispatcher unchanged", async () => {
    const err = Object.assign(new Error("Task t1 not found"), { status: 404 });
    h.runs.runGetTask.mockRejectedValue(err);
    const tool = BASE_TOOLS.find((t) => t.def.name === "get_task")!;
    await expect(tool.run(CTX, ARGS)).rejects.toBe(err);
  });
});
