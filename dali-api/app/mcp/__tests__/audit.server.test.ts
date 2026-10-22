import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogAuditEvent = vi.hoisted(() => vi.fn());
vi.mock("~/lib/audit", () => ({ logAuditEvent: mockLogAuditEvent }));

import {
  MCP_TARGET_KEYS,
  buildMcpToolCallEvent,
  logMcpToolCall,
  mcpArgKeys,
  mcpTargetId,
  mcpToolAction,
} from "../audit.server";

const auth = { user: { id: "u1" }, clientId: "c1", clientName: "Client", grantId: "g1" };

describe("mcpToolAction", () => {
  it("maps read scope to mcp.tool_read", () => {
    expect(mcpToolAction("mcp:read")).toBe("mcp.tool_read");
  });
  it.each(["mcp:write", "mcp:admin"])("keeps mcp.tool_called for %s", (scope) => {
    expect(mcpToolAction(scope)).toBe("mcp.tool_called");
  });
});

describe("mcpTargetId", () => {
  it("returns undefined without args or id-like keys", () => {
    expect(mcpTargetId(undefined)).toBeUndefined();
    expect(mcpTargetId({})).toBeUndefined();
    expect(mcpTargetId({ title: "x", content: "y" })).toBeUndefined();
  });
  it("prefers the most specific entity over its scope", () => {
    expect(mcpTargetId({ projectId: "p1", taskId: "t1" })).toBe("t1");
    expect(mcpTargetId({ projectId: "p1", pageId: "pg1" })).toBe("pg1");
    expect(mcpTargetId({ taskId: "t1", id: "i1" })).toBe("i1");
  });
  it("falls back to projectId last", () => {
    expect(mcpTargetId({ projectId: "p1", title: "x" })).toBe("p1");
  });
  it("skips non-string and empty values", () => {
    expect(mcpTargetId({ id: 5, taskId: "", pageId: null, projectId: "p1" })).toBe("p1");
  });
  it("only ever reads declared keys", () => {
    for (const key of MCP_TARGET_KEYS) expect(mcpTargetId({ [key]: "v" })).toBe("v");
    expect(mcpTargetId({ email: "a@b.c" })).toBeUndefined();
  });
});

describe("mcpArgKeys", () => {
  it("returns sorted keys and no values", () => {
    const keys = mcpArgKeys({ zeta: "secret", alpha: "a@b.c", mid: 1 });
    expect(keys).toEqual(["alpha", "mid", "zeta"]);
    expect(JSON.stringify(keys)).not.toContain("secret");
  });
  it("is empty without args", () => {
    expect(mcpArgKeys(undefined)).toEqual([]);
  });
});

describe("buildMcpToolCallEvent", () => {
  it("builds an ok event with target and arg keys, never values", () => {
    const event = buildMcpToolCallEvent({
      auth,
      toolName: "update_task",
      scope: "mcp:write",
      args: { taskId: "t1", description: "private note" },
    });
    expect(event).toEqual({
      action: "mcp.tool_called",
      userId: "u1",
      targetId: "t1",
      metadata: {
        toolName: "update_task",
        clientId: "c1",
        clientName: "Client",
        grantId: "g1",
        argKeys: ["description", "taskId"],
        outcome: "ok",
      },
    });
    expect(JSON.stringify(event)).not.toContain("private note");
  });
  it("records the error code on failure and no outcome ok", () => {
    const event = buildMcpToolCallEvent({
      auth,
      toolName: "list_projects",
      scope: "mcp:read",
      errorCode: -32002,
    });
    expect(event.action).toBe("mcp.tool_read");
    expect(event.targetId).toBeUndefined();
    expect(event.metadata).toMatchObject({ outcome: "error", errorCode: -32002, argKeys: [] });
  });
});

describe("logMcpToolCall", () => {
  beforeEach(() => mockLogAuditEvent.mockReset());
  it("forwards the built event and request to logAuditEvent", async () => {
    const request = new Request("http://x/mcp");
    await logMcpToolCall({ auth, toolName: "t", scope: "mcp:read", request });
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mcp.tool_read", userId: "u1", request }),
    );
  });
});
