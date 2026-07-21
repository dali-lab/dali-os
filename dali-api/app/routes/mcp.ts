// MCP v1 transport. Hand-rolled JSON-RPC 2.0 over HTTP — no @modelcontextprotocol
// /sdk dependency. Streamable-HTTP semantics not needed for a small tool
// catalog; this responds to POST with a JSON-RPC envelope and is sufficient
// for Claude Desktop / Claude Code to call our tools.

import type { Route } from "./+types/mcp";
import { authenticateMcpRequest } from "~/lib/mcp-auth";
import { checkRateLimit } from "~/lib/rate-limit";
import { logAuditEvent } from "~/lib/audit";
import { safeJson } from "~/lib/safe-json";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";
import { WHOAMI_TOOL, runWhoami } from "~/mcp/tools/whoami";
import {
  LIST_MY_NOTIFICATIONS_TOOL,
  runListMyNotifications,
} from "~/mcp/tools/list-my-notifications";
import {
  LIST_MY_UPCOMING_MEETINGS_TOOL,
  runListMyUpcomingMeetings,
} from "~/mcp/tools/list-my-upcoming-meetings";
import {
  FIND_MUTUAL_FREEBUSY_TOOL,
  runFindMutualFreebusy,
} from "~/mcp/tools/find-mutual-freebusy";
import {
  SEARCH_DIRECTORY_TOOL,
  runSearchDirectory,
} from "~/mcp/tools/search-directory";
import {
  GET_MEMBER_PROFILE_TOOL,
  runGetMemberProfile,
  MemberNotFoundError,
} from "~/mcp/tools/get-member-profile";
import {
  SCHEDULE_MEETING_TOOL,
  runScheduleMeeting,
  ScheduleMeetingError,
} from "~/mcp/tools/schedule-meeting";
import {
  LIST_MY_CALENDAR_LINKS_TOOL,
  runListMyCalendarLinks,
} from "~/mcp/tools/list-my-calendar-links";
import {
  MARK_NOTIFICATION_READ_TOOL,
  runMarkNotificationRead,
  NotificationNotFoundError,
  NotificationForbiddenError,
} from "~/mcp/tools/mark-notification-read";
import {
  RSVP_TO_NOTIFICATION_TOOL,
  runRsvpToNotification,
  RsvpError,
} from "~/mcp/tools/rsvp-to-notification";
import {
  LIST_NOTIFICATION_PREFERENCES_TOOL,
  runListNotificationPreferences,
  SET_NOTIFICATION_PREFERENCE_TOOL,
  runSetNotificationPreference,
  PreferenceValidationError,
} from "~/mcp/tools/notification-preferences";
import {
  CANCEL_MEETING_TOOL,
  runCancelMeeting,
  CancelMeetingError,
} from "~/mcp/tools/cancel-meeting";
import { LIST_GROUPS_TOOL, runListGroups } from "~/mcp/tools/list-groups";
import {
  LIST_MY_PROJECTS_TOOL,
  runListMyProjects,
} from "~/mcp/tools/list-my-projects";
import { LIST_PROJECTS_TOOL, runListProjects } from "~/mcp/tools/list-projects";
import {
  GET_PROJECT_OVERVIEW_TOOL,
  runGetProjectOverview,
  ProjectNotFoundError,
} from "~/mcp/tools/get-project-overview";
import { LIST_MY_TASKS_TOOL, runListMyTasks } from "~/mcp/tools/list-my-tasks";
import {
  UPDATE_TASK_STATUS_TOOL,
  runUpdateTaskStatus,
  UpdateTaskStatusError,
} from "~/mcp/tools/update-task-status";
import {
  CREATE_TASK_TOOL,
  runCreateTask,
  CreateTaskError,
} from "~/mcp/tools/create-task";
import {
  UPDATE_TASK_TOOL,
  runUpdateTask,
  UpdateTaskError,
} from "~/mcp/tools/update-task";
import {
  DELETE_TASK_TOOL,
  runDeleteTask,
  DeleteTaskError,
} from "~/mcp/tools/delete-task";
import {
  ADD_TASK_COMMENT_TOOL,
  runAddTaskComment,
  AddTaskCommentError,
} from "~/mcp/tools/add-task-comment";
import {
  SET_TASK_CHECKLIST_TOOL,
  runSetTaskChecklist,
  SetTaskChecklistError,
} from "~/mcp/tools/set-task-checklist";
import {
  LIST_SPRINTS_TOOL,
  runListSprints,
} from "~/mcp/tools/list-sprints";
import {
  CREATE_SPRINT_TOOL,
  runCreateSprint,
  CreateSprintError,
} from "~/mcp/tools/create-sprint";
import {
  UPDATE_SPRINT_TOOL,
  runUpdateSprint,
  UpdateSprintError,
} from "~/mcp/tools/update-sprint";
import {
  SET_SPRINT_STATUS_TOOL,
  runSetSprintStatus,
  SetSprintStatusError,
} from "~/mcp/tools/set-sprint-status";
import {
  DELETE_SPRINT_TOOL,
  runDeleteSprint,
  DeleteSprintError,
} from "~/mcp/tools/delete-sprint";
import {
  LIST_EPICS_TOOL,
  runListEpics,
} from "~/mcp/tools/list-epics";
import {
  CREATE_EPIC_TOOL,
  runCreateEpic,
  CreateEpicError,
} from "~/mcp/tools/create-epic";
import {
  UPDATE_EPIC_TOOL,
  runUpdateEpic,
  UpdateEpicError,
} from "~/mcp/tools/update-epic";
import {
  DELETE_EPIC_TOOL,
  runDeleteEpic,
  DeleteEpicError,
} from "~/mcp/tools/delete-epic";
import {
  CREATE_STORY_TOOL,
  runCreateStory,
  CreateStoryError,
} from "~/mcp/tools/create-story";
import {
  UPDATE_STORY_TOOL,
  runUpdateStory,
  UpdateStoryError,
} from "~/mcp/tools/update-story";
import {
  DELETE_STORY_TOOL,
  runDeleteStory,
  DeleteStoryError,
} from "~/mcp/tools/delete-story";
import {
  LIST_PROJECT_PAGES_TOOL,
  runListProjectPages,
  ListProjectPagesError,
} from "~/mcp/tools/list-project-pages";
import {
  READ_PAGE_TOOL,
  runReadPage,
  ReadPageError,
} from "~/mcp/tools/read-page";
import {
  CREATE_PAGE_TOOL,
  runCreatePage,
  CreatePageError,
} from "~/mcp/tools/create-page";
import {
  SET_PAGE_CONTENT_TOOL,
  runSetPageContent,
  SetPageContentError,
} from "~/mcp/tools/set-page-content";
import {
  UPDATE_PAGE_TOOL,
  runUpdatePage,
  UpdatePageError,
} from "~/mcp/tools/update-page";
import {
  LIST_PROJECT_FILES_TOOL,
  runListProjectFiles,
  ListProjectFilesError,
} from "~/mcp/tools/list-project-files";
import {
  UPLOAD_PROJECT_FILE_TOOL,
  runUploadProjectFile,
  UploadProjectFileError,
} from "~/mcp/tools/upload-project-file";
import { GET_TASK_TOOL, runGetTask, GetTaskError } from "~/mcp/tools/get-task";
import {
  LINK_TASK_TO_GITHUB_TOOL,
  runLinkTaskToGithub,
  LinkTaskToGithubError,
} from "~/mcp/tools/link-task-to-github";
import {
  UNLINK_TASK_FROM_GITHUB_TOOL,
  runUnlinkTaskFromGithub,
  UnlinkTaskFromGithubError,
} from "~/mcp/tools/unlink-task-from-github";
import { ME_RESOURCE, readMeResource } from "~/mcp/resources/me";
import {
  ANNOUNCEMENTS_ACTIVE_RESOURCE,
  readAnnouncementsActiveResource,
} from "~/mcp/resources/announcements-active";
import {
  FORMS_PENDING_RESOURCE,
  readFormsPendingResource,
} from "~/mcp/resources/forms-pending";
import {
  PROJECT_BOARD_RESOURCE,
  matchProjectBoardUri,
  readProjectBoardResource,
  ProjectBoardNotFoundError,
} from "~/mcp/resources/project-board";
import {
  PROJECT_BACKLOG_RESOURCE,
  matchProjectBacklogUri,
  readProjectBacklogResource,
  ProjectBacklogNotFoundError,
} from "~/mcp/resources/project-backlog";
import { WEEKLY_DIGEST_PROMPT } from "~/mcp/prompts/weekly-digest";
import { MEETING_PREP_PROMPT } from "~/mcp/prompts/meeting-prep";
import { PROJECT_STATUS_PROMPT } from "~/mcp/prompts/project-status";
import { SPRINT_PLANNING_PROMPT } from "~/mcp/prompts/sprint-planning";
import { STANDUP_PROMPT } from "~/mcp/prompts/standup";
import { RETRO_PROMPT } from "~/mcp/prompts/retro";
import type { PromptDefinition } from "~/mcp/prompts/types";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "dali-os", version: "1.0.0" };

const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Static resources — `uri` is a concrete value the client can list and read.
const RESOURCES = [
  ME_RESOURCE,
  ANNOUNCEMENTS_ACTIVE_RESOURCE,
  FORMS_PENDING_RESOURCE,
] as const;

// Templated resources — listed under `resourceTemplates`. The URI carries
// placeholders the client substitutes (RFC 6570 Level-1 expansion). Each
// match function recognizes a concrete URI and yields the captured ids.
const RESOURCE_TEMPLATES = [
  PROJECT_BOARD_RESOURCE,
  PROJECT_BACKLOG_RESOURCE,
] as const;

const PROMPTS: PromptDefinition[] = [
  WEEKLY_DIGEST_PROMPT,
  MEETING_PREP_PROMPT,
  PROJECT_STATUS_PROMPT,
  SPRINT_PLANNING_PROMPT,
  STANDUP_PROMPT,
  RETRO_PROMPT,
];

const CAPABILITIES = {
  tools: { listChanged: false },
  resources: { listChanged: false, subscribe: false },
  prompts: { listChanged: false },
} as const;

const TOOLS = [
  WHOAMI_TOOL,
  LIST_MY_NOTIFICATIONS_TOOL,
  LIST_MY_UPCOMING_MEETINGS_TOOL,
  FIND_MUTUAL_FREEBUSY_TOOL,
  SEARCH_DIRECTORY_TOOL,
  GET_MEMBER_PROFILE_TOOL,
  SCHEDULE_MEETING_TOOL,
  LIST_MY_CALENDAR_LINKS_TOOL,
  MARK_NOTIFICATION_READ_TOOL,
  RSVP_TO_NOTIFICATION_TOOL,
  LIST_NOTIFICATION_PREFERENCES_TOOL,
  SET_NOTIFICATION_PREFERENCE_TOOL,
  CANCEL_MEETING_TOOL,
  LIST_GROUPS_TOOL,
  LIST_MY_PROJECTS_TOOL,
  LIST_PROJECTS_TOOL,
  GET_PROJECT_OVERVIEW_TOOL,
  LIST_MY_TASKS_TOOL,
  GET_TASK_TOOL,
  UPDATE_TASK_STATUS_TOOL,
  // Project hub additions:
  CREATE_TASK_TOOL,
  UPDATE_TASK_TOOL,
  DELETE_TASK_TOOL,
  ADD_TASK_COMMENT_TOOL,
  SET_TASK_CHECKLIST_TOOL,
  LIST_SPRINTS_TOOL,
  CREATE_SPRINT_TOOL,
  UPDATE_SPRINT_TOOL,
  SET_SPRINT_STATUS_TOOL,
  DELETE_SPRINT_TOOL,
  LIST_EPICS_TOOL,
  CREATE_EPIC_TOOL,
  UPDATE_EPIC_TOOL,
  DELETE_EPIC_TOOL,
  CREATE_STORY_TOOL,
  UPDATE_STORY_TOOL,
  DELETE_STORY_TOOL,
  LIST_PROJECT_PAGES_TOOL,
  READ_PAGE_TOOL,
  CREATE_PAGE_TOOL,
  // Notion-export → hub sync additions:
  SET_PAGE_CONTENT_TOOL,
  UPDATE_PAGE_TOOL,
  LIST_PROJECT_FILES_TOOL,
  UPLOAD_PROJECT_FILE_TOOL,
  LINK_TASK_TO_GITHUB_TOOL,
  UNLINK_TASK_FROM_GITHUB_TOOL,
] as const;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};

function rpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: unknown, code: number, message: string, data?: unknown): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    },
    { status: 200 }, // JSON-RPC errors travel inside a 200 OK envelope
  );
}

// Map a runtime error to a JSON-RPC error code. Centralized so each tool's
// error class only needs to expose `.status`; the dispatcher decides the wire
// code. Returns null if `err` doesn't match a known error class — caller
// falls through to the generic -32000.
function rpcErrorFromTool(id: unknown, err: unknown): Response | null {
  // -32003 forbidden, -32004 not found, -32602 invalid params, -32000 generic.
  if (err instanceof MemberNotFoundError) return rpcError(id, -32004, err.message);
  if (err instanceof ProjectNotFoundError) return rpcError(id, -32004, err.message);
  if (err instanceof NotificationNotFoundError) return rpcError(id, -32004, err.message);
  if (err instanceof NotificationForbiddenError) return rpcError(id, -32003, err.message);
  if (err instanceof RsvpError) {
    return rpcError(id, err.status === 403 ? -32003 : -32602, err.message);
  }
  if (err instanceof CancelMeetingError) {
    return rpcError(id, err.status === 403 ? -32003 : -32004, err.message);
  }
  if (err instanceof UpdateTaskStatusError) {
    const code = err.status === 403 ? -32003 : err.status === 404 ? -32004 : -32602;
    return rpcError(id, code, err.message);
  }
  if (err instanceof ScheduleMeetingError) return rpcError(id, -32602, err.message);
  if (err instanceof PreferenceValidationError) return rpcError(id, -32602, err.message);

  // Project-hub error classes share the same `.status` → JSON-RPC code mapping.
  const hubErrors = [
    CreateTaskError,
    UpdateTaskError,
    DeleteTaskError,
    AddTaskCommentError,
    SetTaskChecklistError,
    CreateSprintError,
    UpdateSprintError,
    SetSprintStatusError,
    DeleteSprintError,
    CreateEpicError,
    UpdateEpicError,
    DeleteEpicError,
    CreateStoryError,
    UpdateStoryError,
    DeleteStoryError,
    ListProjectPagesError,
    ReadPageError,
    CreatePageError,
    SetPageContentError,
    UpdatePageError,
    ListProjectFilesError,
    UploadProjectFileError,
    GetTaskError,
    LinkTaskToGithubError,
    UnlinkTaskFromGithubError,
  ];
  for (const klass of hubErrors) {
    if (err instanceof klass) {
      const e = err as { status: number; message: string };
      const code = e.status === 403 ? -32003 : e.status === 404 ? -32004 : -32602;
      return rpcError(id, code, e.message);
    }
  }
  return null;
}

// GET: minimal advertisement. Some clients GET the URL before negotiating;
// 405 also works, but a small JSON capabilities blob is more useful.
export async function loader() {
  return Response.json(
    {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: SERVER_INFO,
      capabilities: CAPABILITIES,
    },
    { status: 200 },
  );
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await authenticateMcpRequest(request);
  if (!auth.ok) return auth.response;

  const limited = checkRateLimit(
    request,
    { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS },
    `grant:${auth.grantId}`,
  );
  if (limited) return limited;

  // Above safeJson's 1 MB default so upload_project_file's base64 payloads
  // fit (13 MB body ≥ the tool's 12M-char base64 cap, ~9 MB decoded).
  // Authed + rate-limited, so the larger cap isn't an open amplification.
  const body = await safeJson<JsonRpcRequest>(request, 13 * 1024 * 1024);
  if (body instanceof Response) return body;

  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcError(body?.id, -32600, "Invalid Request");
  }

  switch (body.method) {
    case "initialize":
      return rpcResult(body.id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: CAPABILITIES,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      // JSON-RPC notifications: no id, no response body. Return 204.
      return new Response(null, { status: 204 });

    case "ping":
      return rpcResult(body.id, {});

    case "tools/list":
      return rpcResult(body.id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const params = body.params as { name?: string; arguments?: unknown } | undefined;
      const toolName = params?.name;
      const tool = TOOLS.find((t) => t.name === toolName);
      if (!tool) {
        return rpcError(body.id, -32601, `Unknown tool: ${toolName}`);
      }
      if (!auth.scopes.includes(tool.requiredScope)) {
        return rpcError(
          body.id,
          -32002,
          `Missing required scope: ${tool.requiredScope}`,
        );
      }

      const validated = validateInput(params?.arguments, tool.inputSchema as JsonSchema);
      if (!validated.ok) {
        return rpcError(body.id, -32602, `Invalid params: ${validated.error}`);
      }
      const args = validated.value as Record<string, unknown>;

      try {
        let payload: unknown;
        switch (tool.name) {
          case "whoami":
            payload = await runWhoami(auth.user);
            break;
          case "list_my_notifications":
            payload = await runListMyNotifications(auth.user.id, args);
            break;
          case "list_my_upcoming_meetings":
            payload = await runListMyUpcomingMeetings(auth.user.id, args);
            break;
          case "find_mutual_freebusy":
            payload = await runFindMutualFreebusy(
              auth.user.id,
              args as Parameters<typeof runFindMutualFreebusy>[1],
            );
            break;
          case "search_directory":
            payload = await runSearchDirectory(
              args as Parameters<typeof runSearchDirectory>[0],
            );
            break;
          case "get_member_profile":
            payload = await runGetMemberProfile(
              auth.user.id,
              args as Parameters<typeof runGetMemberProfile>[1],
            );
            break;
          case "schedule_meeting":
            payload = await runScheduleMeeting(
              auth.user,
              args as Parameters<typeof runScheduleMeeting>[1],
            );
            break;
          case "list_my_calendar_links":
            payload = await runListMyCalendarLinks(auth.user.id);
            break;
          case "mark_notification_read":
            payload = await runMarkNotificationRead(
              auth.user.id,
              args as Parameters<typeof runMarkNotificationRead>[1],
            );
            break;
          case "rsvp_to_notification":
            payload = await runRsvpToNotification(
              auth.user,
              args as Parameters<typeof runRsvpToNotification>[1],
            );
            break;
          case "list_notification_preferences":
            payload = await runListNotificationPreferences(auth.user.id);
            break;
          case "set_notification_preference":
            payload = await runSetNotificationPreference(
              auth.user.id,
              args as Parameters<typeof runSetNotificationPreference>[1],
            );
            break;
          case "cancel_meeting":
            payload = await runCancelMeeting(
              auth.user.id,
              args as Parameters<typeof runCancelMeeting>[1],
            );
            break;
          case "list_groups":
            payload = await runListGroups(
              auth.user.id,
              args as Parameters<typeof runListGroups>[1],
            );
            break;
          case "list_my_projects":
            payload = await runListMyProjects(
              auth.user.id,
              args as Parameters<typeof runListMyProjects>[1],
            );
            break;
          case "list_projects":
            payload = await runListProjects(
              auth.user.id,
              args as Parameters<typeof runListProjects>[1],
            );
            break;
          case "get_project_overview":
            payload = await runGetProjectOverview(
              args as Parameters<typeof runGetProjectOverview>[0],
            );
            break;
          case "list_my_tasks":
            payload = await runListMyTasks(
              auth.user.id,
              args as Parameters<typeof runListMyTasks>[1],
            );
            break;
          case "get_task":
            payload = await runGetTask(
              auth.user.id,
              args as Parameters<typeof runGetTask>[1],
            );
            break;
          case "update_task_status":
            payload = await runUpdateTaskStatus(
              auth.user.id,
              args as Parameters<typeof runUpdateTaskStatus>[1],
            );
            break;
          // Project hub additions:
          case "create_task":
            payload = await runCreateTask(
              auth.user.id,
              args as Parameters<typeof runCreateTask>[1],
            );
            break;
          case "update_task":
            payload = await runUpdateTask(
              auth.user.id,
              args as Parameters<typeof runUpdateTask>[1],
            );
            break;
          case "delete_task":
            payload = await runDeleteTask(
              auth.user.id,
              args as Parameters<typeof runDeleteTask>[1],
            );
            break;
          case "add_task_comment":
            payload = await runAddTaskComment(
              auth.user.id,
              args as Parameters<typeof runAddTaskComment>[1],
            );
            break;
          case "set_task_checklist":
            payload = await runSetTaskChecklist(
              auth.user.id,
              args as Parameters<typeof runSetTaskChecklist>[1],
            );
            break;
          case "list_sprints":
            payload = await runListSprints(
              auth.user.id,
              args as Parameters<typeof runListSprints>[1],
            );
            break;
          case "create_sprint":
            payload = await runCreateSprint(
              auth.user.id,
              args as Parameters<typeof runCreateSprint>[1],
            );
            break;
          case "update_sprint":
            payload = await runUpdateSprint(
              auth.user.id,
              args as Parameters<typeof runUpdateSprint>[1],
            );
            break;
          case "set_sprint_status":
            payload = await runSetSprintStatus(
              auth.user.id,
              args as Parameters<typeof runSetSprintStatus>[1],
            );
            break;
          case "delete_sprint":
            payload = await runDeleteSprint(
              auth.user.id,
              args as Parameters<typeof runDeleteSprint>[1],
            );
            break;
          case "list_epics":
            payload = await runListEpics(
              auth.user.id,
              args as Parameters<typeof runListEpics>[1],
            );
            break;
          case "create_epic":
            payload = await runCreateEpic(
              auth.user.id,
              args as Parameters<typeof runCreateEpic>[1],
            );
            break;
          case "update_epic":
            payload = await runUpdateEpic(
              auth.user.id,
              args as Parameters<typeof runUpdateEpic>[1],
            );
            break;
          case "delete_epic":
            payload = await runDeleteEpic(
              auth.user.id,
              args as Parameters<typeof runDeleteEpic>[1],
            );
            break;
          case "create_story":
            payload = await runCreateStory(
              auth.user.id,
              args as Parameters<typeof runCreateStory>[1],
            );
            break;
          case "update_story":
            payload = await runUpdateStory(
              auth.user.id,
              args as Parameters<typeof runUpdateStory>[1],
            );
            break;
          case "delete_story":
            payload = await runDeleteStory(
              auth.user.id,
              args as Parameters<typeof runDeleteStory>[1],
            );
            break;
          case "list_project_pages":
            payload = await runListProjectPages(
              auth.user.id,
              args as Parameters<typeof runListProjectPages>[1],
            );
            break;
          case "read_page":
            payload = await runReadPage(
              auth.user.id,
              args as Parameters<typeof runReadPage>[1],
            );
            break;
          case "create_page":
            payload = await runCreatePage(
              auth.user.id,
              args as Parameters<typeof runCreatePage>[1],
            );
            break;
          case "set_page_content":
            payload = await runSetPageContent(
              auth.user.id,
              args as Parameters<typeof runSetPageContent>[1],
            );
            break;
          case "update_page":
            payload = await runUpdatePage(
              auth.user.id,
              args as Parameters<typeof runUpdatePage>[1],
            );
            break;
          case "upload_project_file":
            payload = await runUploadProjectFile(
              auth.user.id,
              args as Parameters<typeof runUploadProjectFile>[1],
            );
            break;
          case "list_project_files":
            payload = await runListProjectFiles(
              auth.user.id,
              args as Parameters<typeof runListProjectFiles>[1],
            );
            break;
          case "link_task_to_github":
            payload = await runLinkTaskToGithub(
              auth.user.id,
              args as Parameters<typeof runLinkTaskToGithub>[1],
            );
            break;
          case "unlink_task_from_github":
            payload = await runUnlinkTaskFromGithub(
              auth.user.id,
              args as Parameters<typeof runUnlinkTaskFromGithub>[1],
            );
            break;
          default:
            return rpcError(body.id, -32601, "Tool not implemented");
        }

        await logAuditEvent({
          action: "mcp.tool_called",
          userId: auth.user.id,
          metadata: {
            toolName: tool.name,
            clientId: auth.clientId,
            clientName: auth.clientName,
            grantId: auth.grantId,
          },
          request,
        });

        return rpcResult(body.id, {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload,
        });
      } catch (err) {
        const mapped = rpcErrorFromTool(body.id, err);
        if (mapped) return mapped;
        const message = err instanceof Error ? err.message : "Tool execution failed";
        return rpcError(body.id, -32000, message);
      }
    }

    case "resources/list":
      return rpcResult(body.id, {
        resources: RESOURCES.map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        })),
      });

    case "resources/templates/list":
      return rpcResult(body.id, {
        resourceTemplates: RESOURCE_TEMPLATES.map((r) => ({
          uriTemplate: r.uriTemplate,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        })),
      });

    case "resources/read": {
      const params = body.params as { uri?: string } | undefined;
      const uri = params?.uri;
      if (typeof uri !== "string") {
        return rpcError(body.id, -32602, "Missing uri");
      }

      // Concrete URI match first; fall through to template match.
      const staticResource = RESOURCES.find((r) => r.uri === uri);
      if (staticResource) {
        if (!auth.scopes.includes(staticResource.requiredScope)) {
          return rpcError(
            body.id,
            -32002,
            `Missing required scope: ${staticResource.requiredScope}`,
          );
        }
        try {
          let text: string;
          switch (staticResource.uri) {
            case "dali://me":
              text = await readMeResource(auth.user.id);
              break;
            case "dali://announcements/active":
              text = await readAnnouncementsActiveResource(auth.user.id);
              break;
            case "dali://forms/pending":
              text = await readFormsPendingResource(auth.user.id);
              break;
            default:
              return rpcError(body.id, -32601, "Resource not implemented");
          }

          await logAuditEvent({
            action: "mcp.resource_read",
            userId: auth.user.id,
            metadata: {
              uri: staticResource.uri,
              clientId: auth.clientId,
              clientName: auth.clientName,
              grantId: auth.grantId,
            },
            request,
          });

          return rpcResult(body.id, {
            contents: [
              { uri: staticResource.uri, mimeType: staticResource.mimeType, text },
            ],
          });
        } catch (err) {
          if (err instanceof MemberNotFoundError) {
            return rpcError(body.id, -32004, err.message);
          }
          const message = err instanceof Error ? err.message : "Resource read failed";
          return rpcError(body.id, -32000, message);
        }
      }

      // Templated resource dispatch — match in order and read.
      const boardMatch = matchProjectBoardUri(uri);
      if (boardMatch) {
        if (!auth.scopes.includes(PROJECT_BOARD_RESOURCE.requiredScope)) {
          return rpcError(
            body.id,
            -32002,
            `Missing required scope: ${PROJECT_BOARD_RESOURCE.requiredScope}`,
          );
        }
        try {
          const text = await readProjectBoardResource(boardMatch.projectId);
          await logAuditEvent({
            action: "mcp.resource_read",
            userId: auth.user.id,
            metadata: {
              uri,
              clientId: auth.clientId,
              clientName: auth.clientName,
              grantId: auth.grantId,
            },
            request,
          });
          return rpcResult(body.id, {
            contents: [{ uri, mimeType: PROJECT_BOARD_RESOURCE.mimeType, text }],
          });
        } catch (err) {
          if (err instanceof ProjectBoardNotFoundError) {
            return rpcError(body.id, -32004, err.message);
          }
          const message = err instanceof Error ? err.message : "Resource read failed";
          return rpcError(body.id, -32000, message);
        }
      }

      const backlogMatch = matchProjectBacklogUri(uri);
      if (backlogMatch) {
        if (!auth.scopes.includes(PROJECT_BACKLOG_RESOURCE.requiredScope)) {
          return rpcError(
            body.id,
            -32002,
            `Missing required scope: ${PROJECT_BACKLOG_RESOURCE.requiredScope}`,
          );
        }
        try {
          const text = await readProjectBacklogResource(backlogMatch.projectId);
          await logAuditEvent({
            action: "mcp.resource_read",
            userId: auth.user.id,
            metadata: {
              uri,
              clientId: auth.clientId,
              clientName: auth.clientName,
              grantId: auth.grantId,
            },
            request,
          });
          return rpcResult(body.id, {
            contents: [{ uri, mimeType: PROJECT_BACKLOG_RESOURCE.mimeType, text }],
          });
        } catch (err) {
          if (err instanceof ProjectBacklogNotFoundError) {
            return rpcError(body.id, -32004, err.message);
          }
          const message = err instanceof Error ? err.message : "Resource read failed";
          return rpcError(body.id, -32000, message);
        }
      }

      return rpcError(body.id, -32602, `Unknown resource: ${uri}`);
    }

    case "prompts/list":
      return rpcResult(body.id, {
        prompts: PROMPTS.map((p) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments,
        })),
      });

    case "prompts/get": {
      const params = body.params as
        | { name?: string; arguments?: Record<string, string> }
        | undefined;
      const promptName = params?.name;
      const prompt = PROMPTS.find((p) => p.name === promptName);
      if (!prompt) {
        return rpcError(body.id, -32602, `Unknown prompt: ${promptName}`);
      }

      const promptArgs = params?.arguments ?? {};
      for (const spec of prompt.arguments) {
        if (spec.required && !promptArgs[spec.name]) {
          return rpcError(
            body.id,
            -32602,
            `Missing required argument: ${spec.name}`,
          );
        }
      }

      const messages = prompt.build(promptArgs);

      await logAuditEvent({
        action: "mcp.prompt_rendered",
        userId: auth.user.id,
        metadata: {
          promptName: prompt.name,
          clientId: auth.clientId,
          clientName: auth.clientName,
          grantId: auth.grantId,
        },
        request,
      });

      return rpcResult(body.id, {
        description: prompt.description,
        messages,
      });
    }

    default:
      return rpcError(body.id, -32601, `Method not found: ${body.method}`);
  }
}
