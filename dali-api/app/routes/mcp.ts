// MCP v1 transport. Hand-rolled JSON-RPC 2.0 over HTTP — no @modelcontextprotocol
// /sdk dependency. Streamable-HTTP semantics not needed for a tool catalog
// of one; this responds to POST with a JSON-RPC envelope and is sufficient
// for Claude Desktop / Claude Code to call `whoami`.

import type { Route } from "./+types/mcp";
import { authenticateMcpRequest } from "~/lib/mcp-auth";
import { checkRateLimit } from "~/lib/rate-limit";
import { logAuditEvent } from "~/lib/audit";
import { safeJson } from "~/lib/safe-json";
import { WHOAMI_TOOL, runWhoami } from "~/mcp/tools/whoami";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "dali-os", version: "1.0.0" };

const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;

const TOOLS = [WHOAMI_TOOL] as const;

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

      try {
        let payload: unknown;
        if (tool.name === "whoami") {
          payload = await runWhoami(auth.user);
        } else {
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
        const message = err instanceof Error ? err.message : "Tool execution failed";
        return rpcError(body.id, -32000, message);
      }
    }

    default:
      return rpcError(body.id, -32601, `Method not found: ${body.method}`);
  }
}
