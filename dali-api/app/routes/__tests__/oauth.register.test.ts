import { describe, it, expect, beforeEach, vi } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db", () => ({
  prisma: {
    oAuthClient: {
      create: mockCreate,
      update: mockUpdate,
    },
  },
}));

import { _resetForTests } from "~/lib/rate-limit";
import { action } from "~/routes/oauth.register";

function makeRequest(body: unknown, ip = "203.0.113.10") {
  return new Request("http://localhost/oauth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  _resetForTests();
  vi.clearAllMocks();
  mockCreate.mockImplementation(async ({ data }) => ({
    id: "cuid-abc",
    ...data,
    createdAt: new Date("2026-05-14T18:00:00Z"),
  }));
  mockUpdate.mockImplementation(async ({ where, data }) => ({
    id: where.id,
    clientId: data.clientId,
    name: "MCP Client",
    redirectUris: ["http://127.0.0.1:54113/callback"],
    createdAt: new Date("2026-05-14T18:00:00Z"),
  }));
});

describe("POST /oauth/register", () => {
  it("registers a public loopback client with the MCP policy baked in", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1:54113/callback"],
      client_name: "Claude Code",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client_id).toBe("cuid-abc");
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.grant_types).toEqual(["authorization_code"]);
    expect(body.response_types).toEqual(["code"]);
    expect(body.scope).toBe("mcp:read mcp:write mcp:admin");

    // The created row must have the MCP policy locked in regardless of input.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockCreate.mock.calls[0]![0].data;
    expect(createArgs.allowedProviders).toEqual(["google"]);
    expect(createArgs.requiredAccountType).toBe("member");
    expect(createArgs.requireMembership).toBe(true);
    // mcp:admin is offered to every client but only *granted* at consent for
    // Core/Admin users (role-gated in oauth.consent.tsx).
    expect(createArgs.allowedScopes).toEqual(["mcp:read", "mcp:write", "mcp:admin"]);
    expect(createArgs.isLoopback).toBe(true);
    expect(createArgs.isFirstParty).toBe(false);
  });

  it("defaults client_name when omitted", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1/callback"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(200);
    const createArgs = mockCreate.mock.calls[0]![0].data;
    expect(createArgs.name).toBe("MCP Client");
  });

  it("registers a Claude hosted-https client (claude.ai) with exact-match matching", async () => {
    const req = makeRequest({
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      client_name: "Claude",
      token_endpoint_auth_method: "none",
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(200);
    const createArgs = mockCreate.mock.calls[0]![0].data;
    expect(createArgs.redirectUris).toEqual([
      "https://claude.ai/api/mcp/auth_callback",
    ]);
    // Hosted https callbacks are NOT loopback — they must exact-match only.
    expect(createArgs.isLoopback).toBe(false);
    expect(createArgs.requireMembership).toBe(true);
  });

  it("accepts the claude.com host and its subdomains", async () => {
    for (const uri of [
      "https://claude.com/api/mcp/auth_callback",
      "https://foo.claude.ai/api/mcp/auth_callback",
    ]) {
      vi.clearAllMocks();
      mockCreate.mockImplementation(async ({ data }: any) => ({
        id: "cuid-abc",
        ...data,
        createdAt: new Date("2026-05-14T18:00:00Z"),
      }));
      const res = await action({ request: makeRequest({ redirect_uris: [uri] }) } as any);
      expect(res.status).toBe(200);
      expect(mockCreate.mock.calls[0]![0].data.isLoopback).toBe(false);
    }
  });

  it("rejects an https callback on an untrusted host", async () => {
    const req = makeRequest({
      redirect_uris: ["https://evil.example.com/api/mcp/auth_callback"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_redirect_uri");
  });

  it("does not treat a lookalike host (claude.ai.evil.com) as trusted", async () => {
    const req = makeRequest({
      redirect_uris: ["https://claude.ai.evil.com/api/mcp/auth_callback"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_redirect_uri");
  });

  it("honors MCP_ALLOWED_REDIRECT_HOSTS override", async () => {
    process.env.MCP_ALLOWED_REDIRECT_HOSTS = "connectors.example.org";
    try {
      const res = await action({
        request: makeRequest({
          redirect_uris: ["https://connectors.example.org/cb"],
        }),
      } as any);
      expect(res.status).toBe(200);
      expect(mockCreate.mock.calls[0]![0].data.isLoopback).toBe(false);
      // A default host is no longer trusted once the override is set.
      vi.clearAllMocks();
      const rejected = await action({
        request: makeRequest({
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        }),
      } as any);
      expect(rejected.status).toBe(400);
    } finally {
      delete process.env.MCP_ALLOWED_REDIRECT_HOSTS;
    }
  });

  it("rejects https loopback as invalid_redirect_uri", async () => {
    const req = makeRequest({
      redirect_uris: ["https://127.0.0.1/callback"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_redirect_uri");
  });

  it("rejects 0.0.0.0 as invalid_redirect_uri", async () => {
    const req = makeRequest({
      redirect_uris: ["http://0.0.0.0/callback"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_redirect_uri");
  });

  it("rejects a public-IP redirect_uri", async () => {
    const req = makeRequest({
      redirect_uris: ["http://example.com/callback"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_redirect_uri");
  });

  it("rejects empty redirect_uris", async () => {
    const req = makeRequest({ redirect_uris: [] });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(400);
  });

  it("rejects missing redirect_uris", async () => {
    const req = makeRequest({ client_name: "Foo" });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(400);
  });

  it("rejects token_endpoint_auth_method other than 'none'", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1/callback"],
      token_endpoint_auth_method: "client_secret_basic",
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_client_metadata");
  });

  it("accepts grant_types: ['authorization_code']", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1/callback"],
      grant_types: ["authorization_code"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grant_types).toEqual(["authorization_code"]);
  });

  it("accepts grant_types containing authorization_code + refresh_token, echoes only authorization_code", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1/callback"],
      grant_types: ["authorization_code", "refresh_token"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grant_types).toEqual(["authorization_code"]);
  });

  it("rejects grant_types without authorization_code", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1/callback"],
      grant_types: ["refresh_token"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_client_metadata");
  });

  it("rejects empty grant_types array", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1/callback"],
      grant_types: [],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_client_metadata");
  });

  it("defaults grant_types to ['authorization_code'] when omitted", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1/callback"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grant_types).toEqual(["authorization_code"]);
  });

  it("accepts response_types: ['code']", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1/callback"],
      response_types: ["code"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response_types).toEqual(["code"]);
  });

  it("accepts response_types containing code + token, echoes only code", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1/callback"],
      response_types: ["code", "token"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response_types).toEqual(["code"]);
  });

  it("rejects response_types without code", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1/callback"],
      response_types: ["token"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_client_metadata");
  });

  it("rejects empty response_types array", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1/callback"],
      response_types: [],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_client_metadata");
  });

  it("defaults response_types to ['code'] when omitted", async () => {
    const req = makeRequest({
      redirect_uris: ["http://127.0.0.1/callback"],
    });
    const res = await action({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response_types).toEqual(["code"]);
  });

  it("rate-limits 6th registration from same IP", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 5; i++) {
      const res = await action({
        request: makeRequest({ redirect_uris: ["http://127.0.0.1/callback"] }, ip),
      } as any);
      expect(res.status).toBe(200);
    }
    const limited = await action({
      request: makeRequest({ redirect_uris: ["http://127.0.0.1/callback"] }, ip),
    } as any);
    expect(limited.status).toBe(429);
  });
});
