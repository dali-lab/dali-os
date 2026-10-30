import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogAuditEvent = vi.hoisted(() => vi.fn());
const mockAuthenticate = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("~/lib/mcp-auth", () => ({ authenticateMcpRequest: mockAuthenticate }));
vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: () => null }));

class FakeToolError extends Error {
  status = 403;
}

// Fully mocked (no importActual): the real registry loads every tool module,
// several of which import the generated Prisma client, which CI's unit job
// doesn't generate.
vi.mock("~/mcp/registry", () => {
  const def = (name: string, requiredScope: "mcp:read" | "mcp:write") => ({
    name,
    description: name,
    requiredScope,
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" }, note: { type: "string" } },
      required: [],
    },
  });
  const tools: Record<string, import("~/mcp/registry").McpTool> = {
    fake_read: { def: def("fake_read", "mcp:read"), run: async () => ({ ok: true }) },
    fake_write: { def: def("fake_write", "mcp:write"), run: async () => ({ ok: true }) },
    fake_throw: {
      def: def("fake_throw", "mcp:write"),
      run: async () => {
        throw new FakeToolError("contains user data");
      },
    },
  };
  return {
    findRegistryTool: (n: string) => tools[n],
    registryToolDefs: () => Object.values(tools).map((t) => t.def),
    mapToolError: (err: unknown) =>
      err instanceof FakeToolError ? { code: -32003, message: err.message } : null,
  };
});

import { action } from "../mcp";

function call(name: string, args?: unknown) {
  const request = new Request("http://x/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return action({ request } as Parameters<typeof action>[0]);
}

function loggedEvent() {
  expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
  return mockLogAuditEvent.mock.calls[0][0];
}

describe("mcp tools/call audit", () => {
  beforeEach(() => {
    mockLogAuditEvent.mockReset();
    mockAuthenticate.mockReset();
    mockAuthenticate.mockResolvedValue({
      ok: true,
      user: { id: "u1" },
      scopes: ["mcp:read", "mcp:write"],
      clientId: "c1",
      clientName: "Client",
      grantId: "g1",
    });
  });

  it("logs a read tool as mcp.tool_read", async () => {
    await call("fake_read", { taskId: "t1" });
    expect(loggedEvent()).toMatchObject({
      action: "mcp.tool_read",
      targetId: "t1",
      metadata: { toolName: "fake_read", outcome: "ok" },
    });
  });

  it("logs a write tool as mcp.tool_called with target and arg keys but no values", async () => {
    await call("fake_write", { taskId: "t1", note: "private" });
    const event = loggedEvent();
    expect(event).toMatchObject({
      action: "mcp.tool_called",
      targetId: "t1",
      metadata: { outcome: "ok", argKeys: ["note", "taskId"] },
    });
    expect(JSON.stringify(event.metadata)).not.toContain("private");
  });

  it("logs a thrown tool error with the mapped code and not the message", async () => {
    await call("fake_throw", { taskId: "t1" });
    const event = loggedEvent();
    expect(event).toMatchObject({
      action: "mcp.tool_called",
      targetId: "t1",
      metadata: { outcome: "error", errorCode: -32003 },
    });
    expect(JSON.stringify(event)).not.toContain("user data");
  });

  it("logs a scope denial", async () => {
    mockAuthenticate.mockResolvedValue({
      ok: true,
      user: { id: "u1" },
      scopes: ["mcp:read"],
      clientId: "c1",
      clientName: "Client",
      grantId: "g1",
    });
    await call("fake_write", { taskId: "t1" });
    expect(loggedEvent()).toMatchObject({
      action: "mcp.tool_called",
      metadata: { outcome: "error", errorCode: -32002 },
    });
  });

  it("logs a validation failure", async () => {
    await call("fake_read", { taskId: 5 });
    expect(loggedEvent()).toMatchObject({
      action: "mcp.tool_read",
      metadata: { outcome: "error", errorCode: -32602 },
    });
  });

  it("does not log an unknown tool", async () => {
    await call("nope");
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });
});
