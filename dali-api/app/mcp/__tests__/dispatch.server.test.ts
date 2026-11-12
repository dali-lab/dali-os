import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  logMcpToolCall: vi.fn(),
  readRun: vi.fn(),
  writeRun: vi.fn(),
  flaggedRun: vi.fn(),
  isFeatureEnabled: vi.fn(),
  getUserRoles: vi.fn(),
}));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: h.isFeatureEnabled }));
vi.mock("~/lib/roles", () => ({ getUserRoles: h.getUserRoles }));

vi.mock("~/mcp/audit.server", () => ({ logMcpToolCall: h.logMcpToolCall }));

// Fully mocked: the real registry loads every tool module, several of which
// import the generated Prisma client (absent in CI's unit job).
vi.mock("~/mcp/registry", async () => {
  const { mapToolError } = await import("~/mcp/errors");
  const schema = {
    type: "object",
    properties: { pageId: { type: "string" } },
    required: ["pageId"],
    additionalProperties: false,
  };
  const tools: Record<string, unknown> = {
    read_page: {
      def: { name: "read_page", description: "r", requiredScope: "mcp:read", inputSchema: schema },
      run: h.readRun,
    },
    set_page_content: {
      def: { name: "set_page_content", description: "w", requiredScope: "mcp:write", inputSchema: schema },
      run: h.writeRun,
    },
  };
  tools.flagged_tool = {
    def: { name: "flagged_tool", description: "f", requiredScope: "mcp:read", inputSchema: schema },
    run: h.flaggedRun,
    featureFlag: "core-taskboard",
  };
  return {
    findRegistryTool: (n: string) => tools[n],
    registryToolDefs: () => Object.values(tools).map((t) => (t as { def: object }).def),
    mapToolError,
  };
});

import { dispatchTool, visibleToolDefs, type ToolCaller } from "../dispatch.server";
import { McpForbiddenError, McpNotFoundError } from "../errors";

const USER = {
  id: "u1",
  daliEmail: "ada@dali.example.edu",
  dartmouthEmail: "ada@example.edu",
  netId: "f00001",
  firstName: "Ada",
  lastName: "Lovelace",
};

const request = new Request("http://x/api/ask");

const ASK: ToolCaller = {
  user: USER,
  scopes: ["mcp:read"],
  request,
  origin: "ask",
  clientId: "ask-dali",
  clientName: "Ask DALI",
  grantId: null,
};

const MCP: ToolCaller = {
  ...ASK,
  scopes: ["mcp:read", "mcp:write"],
  origin: "mcp",
  clientId: "c1",
  clientName: "Claude Desktop",
  grantId: "g1",
};

const PAGE = { pageId: "pg1" };

beforeEach(() => vi.resetAllMocks());

describe("dispatchTool", () => {
  it("runs the tool with the caller's user, scopes and request and returns its payload", async () => {
    h.readRun.mockResolvedValue({ title: "Sprint 4 planning" });
    expect(await dispatchTool("read_page", PAGE, ASK)).toEqual({
      ok: true,
      payload: { title: "Sprint 4 planning" },
    });
    expect(h.readRun).toHaveBeenCalledWith({ user: USER, scopes: ["mcp:read"], request }, PAGE);
  });

  it("does not hand the tool the client or grant details", async () => {
    h.readRun.mockResolvedValue({});
    await dispatchTool("read_page", PAGE, MCP);
    expect(Object.keys(h.readRun.mock.calls[0][0]).sort()).toEqual(["request", "scopes", "user"]);
  });

  it("audits a successful call with its origin, client, grant and args", async () => {
    h.readRun.mockResolvedValue({});
    await dispatchTool("read_page", PAGE, ASK);
    expect(h.logMcpToolCall).toHaveBeenCalledTimes(1);
    expect(h.logMcpToolCall).toHaveBeenCalledWith({
      auth: { user: USER, origin: "ask", clientId: "ask-dali", clientName: "Ask DALI", grantId: null },
      toolName: "read_page",
      scope: "mcp:read",
      request,
      args: PAGE,
    });
  });

  it("carries an MCP client's grant into the audit row", async () => {
    h.readRun.mockResolvedValue({});
    await dispatchTool("read_page", PAGE, MCP);
    expect(h.logMcpToolCall.mock.calls[0][0].auth).toEqual({
      user: USER,
      origin: "mcp",
      clientId: "c1",
      clientName: "Claude Desktop",
      grantId: "g1",
    });
  });

  it.each([["nope"], [undefined]])("rejects an unknown tool name %s without running or auditing", async (name) => {
    expect(await dispatchTool(name, {}, ASK)).toEqual({
      ok: false,
      code: -32601,
      message: `Unknown tool: ${name}`,
    });
    expect(h.logMcpToolCall).not.toHaveBeenCalled();
  });

  it("refuses a write tool to a read-only caller, audits the denial and never runs it", async () => {
    expect(await dispatchTool("set_page_content", PAGE, ASK)).toEqual({
      ok: false,
      code: -32002,
      message: "Missing required scope: mcp:write",
    });
    expect(h.writeRun).not.toHaveBeenCalled();
    expect(h.logMcpToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "set_page_content", scope: "mcp:write", errorCode: -32002 }),
    );
    expect(h.logMcpToolCall.mock.calls[0][0].args).toBeUndefined();
  });

  it("allows the write tool once the caller holds the scope", async () => {
    h.writeRun.mockResolvedValue({ ok: true });
    expect(await dispatchTool("set_page_content", PAGE, MCP)).toEqual({ ok: true, payload: { ok: true } });
  });

  it.each([
    ["a missing required field", {}],
    ["a wrong type", { pageId: 5 }],
    ["an unexpected field", { pageId: "pg1", extra: true }],
  ])("rejects %s before running and audits it without args", async (_label, args) => {
    const result = await dispatchTool("read_page", args, ASK);
    expect(result).toMatchObject({ ok: false, code: -32602 });
    expect(result.ok === false && result.message).toMatch(/^Invalid params: /);
    expect(h.readRun).not.toHaveBeenCalled();
    const entry = h.logMcpToolCall.mock.calls[0][0];
    expect(entry.errorCode).toBe(-32602);
    expect(entry.args).toBeUndefined();
  });

  it("validates missing arguments as an empty object", async () => {
    const schemaless = await dispatchTool("read_page", undefined, ASK);
    expect(schemaless).toMatchObject({ ok: false, code: -32602 });
    expect(schemaless.ok === false && schemaless.message).toContain("pageId");
  });

  it.each([
    ["not found", new McpNotFoundError("Page pg1 not found"), -32004],
    ["forbidden", new McpForbiddenError("No access"), -32003],
  ])("maps a %s tool error to its code and audits it", async (_label, err, code) => {
    h.readRun.mockRejectedValue(err);
    expect(await dispatchTool("read_page", PAGE, ASK)).toEqual({ ok: false, code, message: err.message });
    expect(h.logMcpToolCall).toHaveBeenCalledWith(expect.objectContaining({ args: PAGE, errorCode: code }));
  });

  it("returns -32000 with the message for an unmapped error, or a generic one for a non-error", async () => {
    h.readRun.mockRejectedValueOnce(new Error("kaput"));
    expect(await dispatchTool("read_page", PAGE, ASK)).toEqual({ ok: false, code: -32000, message: "kaput" });
    h.readRun.mockRejectedValueOnce("thrown string");
    expect(await dispatchTool("read_page", PAGE, ASK)).toEqual({
      ok: false,
      code: -32000,
      message: "Tool execution failed",
    });
    expect(h.logMcpToolCall).toHaveBeenLastCalledWith(expect.objectContaining({ errorCode: -32000 }));
  });
});

describe("feature-flagged tools", () => {
  beforeEach(() => {
    h.getUserRoles.mockResolvedValue({ isCore: true });
  });

  it("answers a flag-off tool like an unknown one and never runs it", async () => {
    h.isFeatureEnabled.mockResolvedValue(false);
    expect(await dispatchTool("flagged_tool", PAGE, MCP)).toEqual({
      ok: false,
      code: -32601,
      message: "Unknown tool: flagged_tool",
    });
    expect(h.flaggedRun).not.toHaveBeenCalled();
    expect(h.isFeatureEnabled).toHaveBeenCalledWith("core-taskboard", "u1", { isCore: true }, request);
  });

  it("runs a flag-on tool", async () => {
    h.isFeatureEnabled.mockResolvedValue(true);
    h.flaggedRun.mockResolvedValue({ ok: 1 });
    expect(await dispatchTool("flagged_tool", PAGE, MCP)).toEqual({ ok: true, payload: { ok: 1 } });
  });

  it("does not look up a flag for an unflagged tool", async () => {
    h.readRun.mockResolvedValue({});
    await dispatchTool("read_page", PAGE, MCP);
    expect(h.isFeatureEnabled).not.toHaveBeenCalled();
  });

  it("omits flag-off tools from the visible list and keeps scope filtering", async () => {
    h.isFeatureEnabled.mockResolvedValue(false);
    const names = (await visibleToolDefs(MCP)).map((d) => d.name);
    expect(names).toEqual(["read_page", "set_page_content"]);
    const readOnly = (await visibleToolDefs({ ...MCP, scopes: ["mcp:read"] })).map((d) => d.name);
    expect(readOnly).toEqual(["read_page"]);
  });

  it("lists a flag-on tool and evaluates each flag once", async () => {
    h.isFeatureEnabled.mockResolvedValue(true);
    const names = (await visibleToolDefs(MCP)).map((d) => d.name);
    expect(names).toContain("flagged_tool");
    expect(h.isFeatureEnabled).toHaveBeenCalledTimes(1);
  });
});
