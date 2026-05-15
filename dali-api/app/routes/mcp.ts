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

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "dali-os", version: "1.0.0" };

const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;

const TOOLS = [
  WHOAMI_TOOL,
  LIST_MY_NOTIFICATIONS_TOOL,
  LIST_MY_UPCOMING_MEETINGS_TOOL,
  FIND_MUTUAL_FREEBUSY_TOOL,
  SEARCH_DIRECTORY_TOOL,
  GET_MEMBER_PROFILE_TOOL,
  SCHEDULE_MEETING_TOOL,
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
      capabilities: { tools: { listChanged: false } },
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
        capabilities: { tools: { listChanged: false } },
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
        if (err instanceof ScheduleMeetingError) {
          return rpcError(body.id, -32602, err.message);
        }
        const message = err instanceof Error ? err.message : "Tool execution failed";
        return rpcError(body.id, -32000, message);
      }
    }

    default:
      return rpcError(body.id, -32601, `Method not found: ${body.method}`);
  }
}
