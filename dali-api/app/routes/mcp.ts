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
  CANCEL_MEETING_TOOL,
  runCancelMeeting,
  CancelMeetingError,
} from "~/mcp/tools/cancel-meeting";
import { LIST_GROUPS_TOOL, runListGroups } from "~/mcp/tools/list-groups";
import {
  LIST_MY_PROJECTS_TOOL,
  runListMyProjects,
} from "~/mcp/tools/list-my-projects";
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
import { ME_RESOURCE, readMeResource } from "~/mcp/resources/me";
import {
  ANNOUNCEMENTS_ACTIVE_RESOURCE,
  readAnnouncementsActiveResource,
} from "~/mcp/resources/announcements-active";
import {
  FORMS_PENDING_RESOURCE,
  readFormsPendingResource,
} from "~/mcp/resources/forms-pending";
import { WEEKLY_DIGEST_PROMPT } from "~/mcp/prompts/weekly-digest";
import { MEETING_PREP_PROMPT } from "~/mcp/prompts/meeting-prep";
import { PROJECT_STATUS_PROMPT } from "~/mcp/prompts/project-status";
import type { PromptDefinition } from "~/mcp/prompts/types";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "dali-os", version: "1.0.0" };

const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;

const RESOURCES = [
  ME_RESOURCE,
  ANNOUNCEMENTS_ACTIVE_RESOURCE,
  FORMS_PENDING_RESOURCE,
] as const;

const PROMPTS: PromptDefinition[] = [
  WEEKLY_DIGEST_PROMPT,
  MEETING_PREP_PROMPT,
  PROJECT_STATUS_PROMPT,
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
  CANCEL_MEETING_TOOL,
  LIST_GROUPS_TOOL,
  LIST_MY_PROJECTS_TOOL,
  GET_PROJECT_OVERVIEW_TOOL,
  LIST_MY_TASKS_TOOL,
  UPDATE_TASK_STATUS_TOOL,
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

// Exported so tests / introspection can list resource + prompt catalogs
// without spinning up the full action handler.
export { RESOURCES, PROMPTS };

export async function action({ request }: Route.ActionArgs) {
  const auth = await authenticateMcpRequest(request);
  if (!auth.ok) return auth.response;

  const limited = checkRateLimit(
    request,
    { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS },
    `grant:${auth.grantId}`,
  );
  if (limited) return limited;

  const body = await safeJson<JsonRpcRequest>(request);
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
          case "update_task_status":
            payload = await runUpdateTaskStatus(
              auth.user.id,
              args as Parameters<typeof runUpdateTaskStatus>[1],
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
        if (err instanceof MemberNotFoundError) {
          return rpcError(body.id, -32004, err.message);
        }
        if (err instanceof ProjectNotFoundError) {
          return rpcError(body.id, -32004, err.message);
        }
        if (err instanceof NotificationNotFoundError) {
          return rpcError(body.id, -32004, err.message);
        }
        if (err instanceof NotificationForbiddenError) {
          return rpcError(body.id, -32003, err.message);
        }
        if (err instanceof RsvpError) {
          // 403 → forbidden code; everything else maps to invalid params.
          return rpcError(body.id, err.status === 403 ? -32003 : -32602, err.message);
        }
        if (err instanceof CancelMeetingError) {
          return rpcError(body.id, err.status === 403 ? -32003 : -32004, err.message);
        }
        if (err instanceof UpdateTaskStatusError) {
          const code = err.status === 403 ? -32003 : err.status === 404 ? -32004 : -32602;
          return rpcError(body.id, code, err.message);
        }
        if (err instanceof ScheduleMeetingError) {
          return rpcError(body.id, -32602, err.message);
        }
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

    case "resources/read": {
      const params = body.params as { uri?: string } | undefined;
      const uri = params?.uri;
      const resource = RESOURCES.find((r) => r.uri === uri);
      if (!resource) {
        return rpcError(body.id, -32602, `Unknown resource: ${uri}`);
      }
      if (!auth.scopes.includes(resource.requiredScope)) {
        return rpcError(
          body.id,
          -32002,
          `Missing required scope: ${resource.requiredScope}`,
        );
      }
      try {
        let text: string;
        switch (resource.uri) {
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
            uri: resource.uri,
            clientId: auth.clientId,
            clientName: auth.clientName,
            grantId: auth.grantId,
          },
          request,
        });

        return rpcResult(body.id, {
          contents: [
            {
              uri: resource.uri,
              mimeType: resource.mimeType,
              text,
            },
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
