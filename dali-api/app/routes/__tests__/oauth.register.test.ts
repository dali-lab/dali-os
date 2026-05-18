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
    expect(body.scope).toBe("mcp:read mcp:write");

    // The created row must have the MCP policy locked in regardless of input.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockCreate.mock.calls[0]![0].data;
    expect(createArgs.allowedProviders).toEqual(["google"]);
    expect(createArgs.requiredAccountType).toBe("member");
    expect(createArgs.requireMembership).toBe(true);
    expect(createArgs.allowedScopes).toEqual(["mcp:read", "mcp:write"]);
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
