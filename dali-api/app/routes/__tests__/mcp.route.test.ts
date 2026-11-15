import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class StatusError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  }
  class NotFound extends Error {}
  return {
    StatusError,
    NotFound,
    authenticate: vi.fn(),
    checkRateLimit: vi.fn(),
    logAuditEvent: vi.fn(),
    logMcpToolCall: vi.fn(),
    enterAgentContext: vi.fn(),
    readMe: vi.fn(),
    readBoard: vi.fn(),
    registryRun: vi.fn(),
    isFeatureEnabled: vi.fn(),
    readRun: vi.fn(),
  };
});

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: h.isFeatureEnabled }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn().mockResolvedValue({}) }));
vi.mock("~/lib/mcp-auth.server", () => ({ authenticateMcpRequest: h.authenticate }));
vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: h.logAuditEvent }));
vi.mock("~/mcp/audit.server", () => ({ logMcpToolCall: h.logMcpToolCall }));
vi.mock("~/collab/agent-presence.server", () => ({ enterAgentContext: h.enterAgentContext }));

// Fully mocked: the real registry loads every tool module, several of which
// import the generated Prisma client (absent in CI's unit job).
vi.mock("~/mcp/registry", async () => {
  const { mapToolError } = await import("~/mcp/errors");
  const tools: Record<string, unknown> = {
    reg_tool: {
      def: {
        name: "reg_tool",
        description: "d",
        requiredScope: "mcp:write",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
      run: h.registryRun,
    },
    read_tool: {
      def: { name: "read_tool", description: "r", requiredScope: "mcp:read", inputSchema: { type: "object" } },
      run: h.readRun,
    },
    flagged_tool: {
      def: { name: "flagged_tool", description: "f", requiredScope: "mcp:read", inputSchema: { type: "object" } },
      run: vi.fn(),
      featureFlag: "core-taskboard",
    },
    admin_tool: {
      def: { name: "admin_tool", description: "a", requiredScope: "mcp:admin", inputSchema: { type: "object" } },
      run: vi.fn(),
    },
  };
  return {
    findRegistryTool: (n: string) => tools[n],
    registryToolDefs: () =>
      Object.values(tools).map((t) => (t as { def: object }).def),
    mapToolError,
  };
});

vi.mock("~/mcp/tools/get-member-profile", () => ({ MemberNotFoundError: h.NotFound }));
vi.mock("~/mcp/resources/me", () => ({
  ME_RESOURCE: {
    uri: "dali://me",
    name: "me",
    description: "me",
    mimeType: "application/json",
    requiredScope: "mcp:read",
  },
  readMeResource: h.readMe,
}));
vi.mock("~/mcp/resources/project-board", () => ({
  PROJECT_BOARD_RESOURCE: {
    uriTemplate: "dali://projects/{projectId}/board",
    name: "board",
    description: "board",
    mimeType: "application/json",
    requiredScope: "mcp:write",
  },
  matchProjectBoardUri: (uri: string) => {
    const mt = /^dali:\/\/projects\/([^/]+)\/board$/.exec(uri);
    return mt ? { projectId: mt[1] } : null;
  },
  readProjectBoardResource: h.readBoard,
  ProjectBoardNotFoundError: h.NotFound,
}));

import { action, loader } from "../mcp";

const AUTH = {
  ok: true,
  user: { id: "u1", firstName: "Ada", lastName: "Lovelace" },
  scopes: ["mcp:read", "mcp:write"],
  clientId: "c1",
  clientName: "Test Client",
  grantId: "g1",
};

function rpc(method: string, params?: unknown, id: unknown = 1) {
  return send({ jsonrpc: "2.0", id, method, params });
}

async function send(body: unknown, rawBody?: string) {
  const request = new Request("http://x/mcp", {
    method: "POST",
    body: rawBody ?? JSON.stringify(body),
  });
  return (await action({ request } as Parameters<typeof action>[0])) as Response;
}

async function errorOf(res: Response) {
  const json = await res.json();
  return json.error as { code: number; message: string };
}

beforeEach(() => {
  vi.resetAllMocks();
  h.authenticate.mockResolvedValue(AUTH);
  h.checkRateLimit.mockReturnValue(null);
});

describe("mcp transport gate", () => {
  it("GET advertises protocol info", async () => {
    const json = await (await loader()).json();
    expect(json).toMatchObject({
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: "dali-os",
        title: "DALI OS",
        icons: [expect.objectContaining({ src: expect.stringMatching(/\/icon-blue\.png$/) })],
      },
      capabilities: { tools: { listChanged: false } },
    });
  });

  it("returns the auth failure response and does no further work", async () => {
    const denied = new Response("unauthorized", { status: 401 });
    h.authenticate.mockResolvedValue({ ok: false, response: denied });
    const res = await rpc("tools/list");
    expect(res).toBe(denied);
    expect(h.checkRateLimit).not.toHaveBeenCalled();
  });

  it("rate limits per grant and returns the limiter response", async () => {
    const limited = new Response("slow down", { status: 429 });
    h.checkRateLimit.mockReturnValue(limited);
    const res = await rpc("tools/list");
    expect(res).toBe(limited);
    expect(h.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      { max: 120, windowMs: 60_000 },
      "grant:g1",
    );
  });

  it("returns 400 for a missing body and 413 for an oversized one", async () => {
    const empty = await action({
      request: new Request("http://x/mcp", { method: "POST" }),
    } as Parameters<typeof action>[0]);
    expect((empty as Response).status).toBe(400);
    const big = await action({
      request: new Request("http://x/mcp", {
        method: "POST",
        headers: { "content-length": String(14 * 1024 * 1024) },
        body: "{}",
      }),
    } as Parameters<typeof action>[0]);
    expect((big as Response).status).toBe(413);
  });

  it.each([
    ["wrong jsonrpc version", { jsonrpc: "1.0", id: 4, method: "ping" }],
    ["non-string method", { jsonrpc: "2.0", id: 4, method: 5 }],
    ["missing method", { jsonrpc: "2.0", id: 4 }],
  ])("rejects %s with -32600 echoing the id", async (_n, body) => {
    const res = await send(body);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toEqual({ code: -32600, message: "Invalid Request" });
    expect(json.id).toBe(4);
  });

  it("rejects a JSON null body with -32600", async () => {
    const json = await (await send(null)).json();
    expect(json.error.code).toBe(-32600);
    expect(json.id).toBeNull();
  });

  it("answers initialize, ping and notifications", async () => {
    const init = await (await rpc("initialize")).json();
    expect(init.result.protocolVersion).toBe("2024-11-05");
    expect((await (await rpc("ping")).json()).result).toEqual({});
    for (const method of ["notifications/initialized", "notifications/cancelled"]) {
      const res = await rpc(method);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    }
  });

  it("rejects unknown methods with -32601", async () => {
    const err = await errorOf(await rpc("nope/nothing"));
    expect(err).toEqual({ code: -32601, message: "Method not found: nope/nothing" });
  });
});

describe("tools/list", () => {
  it("omits a flag-off tool and lists it once the flag is on", async () => {
    h.isFeatureEnabled.mockResolvedValue(false);
    let { result } = await (await rpc("tools/list")).json();
    expect(result.tools.map((t: { name: string }) => t.name)).not.toContain("flagged_tool");
    h.isFeatureEnabled.mockResolvedValue(true);
    ({ result } = await (await rpc("tools/list")).json());
    expect(result.tools.map((t: { name: string }) => t.name)).toContain("flagged_tool");
  });

  it("lists registry tools with only name, description and schema", async () => {
    const { result } = await (await rpc("tools/list")).json();
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual(["reg_tool", "read_tool"]);
    for (const t of result.tools) {
      expect(Object.keys(t).sort()).toEqual(["description", "inputSchema", "name"]);
    }
  });

  it("lists only the tools a read-only caller can call", async () => {
    h.authenticate.mockResolvedValue({ ...AUTH, scopes: ["mcp:read"] });
    const { result } = await (await rpc("tools/list")).json();
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual(["read_tool"]);
  });

  it("lists admin tools only with the admin scope", async () => {
    h.authenticate.mockResolvedValue({ ...AUTH, scopes: ["mcp:read", "mcp:write", "mcp:admin"] });
    const { result } = await (await rpc("tools/list")).json();
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual(["reg_tool", "read_tool", "admin_tool"]);
  });

  it("lists nothing for a caller with no MCP scopes", async () => {
    h.authenticate.mockResolvedValue({ ...AUTH, scopes: [] });
    const { result } = await (await rpc("tools/list")).json();
    expect(result.tools).toEqual([]);
  });
});

describe("tools/call", () => {
  it("enters the agent context with the caller's identity, keyed to its grant", async () => {
    h.readRun.mockResolvedValue({});
    await rpc("tools/call", { name: "read_tool" });
    expect(h.enterAgentContext).toHaveBeenCalledWith({
      clientName: "Test Client",
      userId: "u1",
      ownerName: "Ada Lovelace",
      session: "g1",
    });
  });

  it("-32601 for unknown tools or a missing name, without audit", async () => {
    expect(await errorOf(await rpc("tools/call", { name: "nope" }))).toEqual({
      code: -32601,
      message: "Unknown tool: nope",
    });
    expect((await errorOf(await rpc("tools/call", {}))).code).toBe(-32601);
    expect(h.logMcpToolCall).not.toHaveBeenCalled();
  });

  it("runs with user, scopes and request, returning text plus structured content", async () => {
    h.registryRun.mockResolvedValue({ done: true });
    const json = await (
      await rpc("tools/call", { name: "reg_tool", arguments: { id: "x" } }, "abc")
    ).json();
    expect(json.id).toBe("abc");
    expect(json.result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ done: true }) }],
      structuredContent: { done: true },
    });
    expect(h.registryRun).toHaveBeenCalledWith(
      { user: AUTH.user, scopes: AUTH.scopes, request: expect.any(Request) },
      { id: "x" },
    );
  });

  it("audits a successful call with the tool, scope and args and no error code", async () => {
    h.registryRun.mockResolvedValue({});
    await rpc("tools/call", { name: "reg_tool", arguments: { id: "x" } });
    expect(h.logMcpToolCall).toHaveBeenCalledTimes(1);
    const entry = h.logMcpToolCall.mock.calls[0][0];
    expect(entry).toMatchObject({ toolName: "reg_tool", scope: "mcp:write", args: { id: "x" } });
    expect(entry.errorCode).toBeUndefined();
  });

  it("treats missing arguments as an empty object", async () => {
    h.readRun.mockResolvedValue({});
    await rpc("tools/call", { name: "read_tool" });
    expect(h.readRun).toHaveBeenCalledWith(expect.anything(), {});
  });

  it("denies a tool whose scope the grant lacks, without running it", async () => {
    h.authenticate.mockResolvedValue({ ...AUTH, scopes: ["mcp:read"] });
    const err = await errorOf(await rpc("tools/call", { name: "reg_tool", arguments: { id: "x" } }));
    expect(err).toEqual({ code: -32002, message: "Missing required scope: mcp:write" });
    expect(h.registryRun).not.toHaveBeenCalled();
    expect(h.logMcpToolCall).toHaveBeenCalledWith(expect.objectContaining({ errorCode: -32002 }));
  });

  it("rejects invalid params without running the tool", async () => {
    const err = await errorOf(await rpc("tools/call", { name: "reg_tool", arguments: {} }));
    expect(err.code).toBe(-32602);
    expect(err.message).toMatch(/^Invalid params: /);
    expect(h.registryRun).not.toHaveBeenCalled();
    expect(h.logMcpToolCall).toHaveBeenCalledWith(expect.objectContaining({ errorCode: -32602 }));
  });

  it.each([
    [403, -32003],
    [404, -32004],
    [400, -32602],
    [422, -32602],
  ])("maps a tool error with status %i to %i and audits the code", async (status, code) => {
    h.registryRun.mockRejectedValue(new h.StatusError("boom", status));
    const err = await errorOf(await rpc("tools/call", { name: "reg_tool", arguments: { id: "x" } }));
    expect(err).toEqual({ code, message: "boom" });
    expect(h.logMcpToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ args: { id: "x" }, errorCode: code }),
    );
  });

  it("maps unknown errors to -32000 with the message, or a generic one for non-errors", async () => {
    h.readRun.mockRejectedValueOnce(new Error("kaput"));
    expect(await errorOf(await rpc("tools/call", { name: "read_tool" }))).toEqual({
      code: -32000,
      message: "kaput",
    });
    h.readRun.mockRejectedValueOnce("string thrown");
    expect(await errorOf(await rpc("tools/call", { name: "read_tool" }))).toEqual({
      code: -32000,
      message: "Tool execution failed",
    });
    expect(h.logMcpToolCall).toHaveBeenLastCalledWith(expect.objectContaining({ errorCode: -32000 }));
  });
});

describe("resources", () => {
  it("lists static resources and templates", async () => {
    const res = await (await rpc("resources/list")).json();
    expect(res.result.resources.map((r: { uri: string }) => r.uri)).toContain("dali://me");
    const tpl = await (await rpc("resources/templates/list")).json();
    expect(tpl.result.resourceTemplates.map((r: { uriTemplate: string }) => r.uriTemplate)).toContain(
      "dali://projects/{projectId}/board",
    );
  });

  it("requires a string uri", async () => {
    expect(await errorOf(await rpc("resources/read", {}))).toEqual({ code: -32602, message: "Missing uri" });
  });

  it("reads a static resource for the caller and audits the read", async () => {
    h.readMe.mockResolvedValue("me-text");
    const json = await (await rpc("resources/read", { uri: "dali://me" })).json();
    expect(h.readMe).toHaveBeenCalledWith("u1");
    expect(json.result.contents).toEqual([
      { uri: "dali://me", mimeType: "application/json", text: "me-text" },
    ]);
    expect(h.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mcp.resource_read",
        userId: "u1",
        metadata: { uri: "dali://me", clientId: "c1", clientName: "Test Client", grantId: "g1" },
      }),
    );
  });

  it("denies static resources without the scope and does not read", async () => {
    h.authenticate.mockResolvedValue({ ...AUTH, scopes: [] });
    expect((await errorOf(await rpc("resources/read", { uri: "dali://me" }))).code).toBe(-32002);
    expect(h.readMe).not.toHaveBeenCalled();
    expect(h.logAuditEvent).not.toHaveBeenCalled();
  });

  it("maps resource read failures without auditing", async () => {
    h.readMe.mockRejectedValueOnce(new h.NotFound("gone"));
    expect(await errorOf(await rpc("resources/read", { uri: "dali://me" }))).toEqual({
      code: -32004,
      message: "gone",
    });
    h.readMe.mockRejectedValueOnce(new Error("db"));
    expect(await errorOf(await rpc("resources/read", { uri: "dali://me" }))).toEqual({
      code: -32000,
      message: "db",
    });
    expect(h.logAuditEvent).not.toHaveBeenCalled();
  });

  it("reads a templated resource with the captured id and audits the concrete uri", async () => {
    h.readBoard.mockResolvedValue("board-text");
    const uri = "dali://projects/p42/board";
    const json = await (await rpc("resources/read", { uri })).json();
    expect(h.readBoard).toHaveBeenCalledWith("p42");
    expect(json.result.contents[0]).toEqual({ uri, mimeType: "application/json", text: "board-text" });
    expect(h.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mcp.resource_read", metadata: expect.objectContaining({ uri }) }),
    );
  });

  it("enforces scope and maps not-found on templated resources", async () => {
    const uri = "dali://projects/p42/board";
    h.authenticate.mockResolvedValue({ ...AUTH, scopes: ["mcp:read"] });
    expect((await errorOf(await rpc("resources/read", { uri }))).code).toBe(-32002);
    expect(h.readBoard).not.toHaveBeenCalled();
    h.authenticate.mockResolvedValue(AUTH);
    h.readBoard.mockRejectedValue(new h.NotFound("no project"));
    expect(await errorOf(await rpc("resources/read", { uri }))).toEqual({ code: -32004, message: "no project" });
  });

  it("rejects unknown uris with -32602", async () => {
    expect(await errorOf(await rpc("resources/read", { uri: "dali://secrets" }))).toEqual({
      code: -32602,
      message: "Unknown resource: dali://secrets",
    });
  });
});

describe("prompts", () => {
  it("lists prompts with their argument specs", async () => {
    const { result } = await (await rpc("prompts/list")).json();
    const standup = result.prompts.find((p: { name: string }) => p.name === "standup");
    expect(standup.arguments).toEqual([expect.objectContaining({ name: "projectId", required: true })]);
  });

  it("rejects unknown prompts and missing required arguments", async () => {
    expect(await errorOf(await rpc("prompts/get", { name: "zzz" }))).toEqual({
      code: -32602,
      message: "Unknown prompt: zzz",
    });
    expect(await errorOf(await rpc("prompts/get", { name: "standup", arguments: {} }))).toEqual({
      code: -32602,
      message: "Missing required argument: projectId",
    });
    expect(h.logAuditEvent).not.toHaveBeenCalled();
  });

  it("renders a prompt with the supplied args and audits it", async () => {
    const { result } = await (
      await rpc("prompts/get", { name: "standup", arguments: { projectId: "p99" } })
    ).json();
    expect(result.messages[0].content.text).toContain("p99");
    expect(h.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mcp.prompt_rendered",
        userId: "u1",
        metadata: { promptName: "standup", clientId: "c1", clientName: "Test Client", grantId: "g1" },
      }),
    );
  });
});
