// MCP v1 transport. Hand-rolled JSON-RPC 2.0 over HTTP — no @modelcontextprotocol
// /sdk dependency. Streamable-HTTP semantics not needed for a small tool
// catalog; this responds to POST with a JSON-RPC envelope and is sufficient
// for Claude Desktop / Claude Code to call our tools.

import type { Route } from "./+types/mcp";
import { authenticateMcpRequest } from "~/lib/mcp-auth";
import { checkRateLimit } from "~/lib/rate-limit";
import { logAuditEvent } from "~/lib/audit";
import { enterAgentContext } from "~/collab/agent-presence.server";
import { safeJson } from "~/lib/safe-json";
import { registryToolDefs } from "~/mcp/registry";
import { dispatchTool } from "~/mcp/dispatch.server";
import { MemberNotFoundError } from "~/mcp/tools/get-member-profile";
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
        tools: registryToolDefs().filter((d) => auth.scopes.includes(d.requiredScope)).map((d) => ({
          name: d.name,
          description: d.description,
          inputSchema: d.inputSchema,
        })),
      });

    case "tools/call": {
      const params = body.params as { name?: string; arguments?: unknown } | undefined;
      const toolName = params?.name;
      enterAgentContext({
        clientName: auth.clientName,
        userId: auth.user.id,
        ownerName: `${auth.user.firstName} ${auth.user.lastName}`.trim(),
        session: auth.grantId,
      });

      const result = await dispatchTool(toolName, params?.arguments, {
        user: auth.user,
        scopes: auth.scopes,
        request,
        origin: "mcp",
        clientId: auth.clientId,
        clientName: auth.clientName,
        grantId: auth.grantId,
      });
      if (!result.ok) return rpcError(body.id, result.code, result.message);
      return rpcResult(body.id, {
        content: [{ type: "text", text: JSON.stringify(result.payload) }],
        structuredContent: result.payload,
      });
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
