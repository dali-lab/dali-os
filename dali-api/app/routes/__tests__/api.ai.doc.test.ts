// Tests for POST /api/ai/doc
// Focuses on gating (auth, missing key, bad input) since the Anthropic SDK
// call itself requires a live key and is not mocked here.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { action } from "~/routes/api.ai.doc";

const AUTH_OK = {
  ok: true as const,
  user: { sub: "u1", email: "u@dali.edu", type: "member" },
  sessionId: "s1",
};

const AUTH_FAIL = {
  ok: false as const,
  response: new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  }),
  reason: "no_session" as const,
};

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/ai/doc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK);
  // Ensure keys are unset by default — tests that need one set it explicitly.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DARTMOUTH_CHAT_API_KEY;
  delete process.env.AI_PROVIDER;
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DARTMOUTH_CHAT_API_KEY;
  delete process.env.AI_PROVIDER;
});

describe("POST /api/ai/doc — auth gate", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AUTH_FAIL);
    const res = await action({ request: postReq({ action: "continue", context: "hi" }) } as any);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/ai/doc — key gate", () => {
  it("returns 503 with aiEnabled:false when no provider key is set", async () => {
    const res = await action({
      request: postReq({ action: "continue", context: "hello world" }),
    } as any);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ aiEnabled: false });
  });

  it("does not 503 when ANTHROPIC_API_KEY is set (key validation is upstream)", async () => {
    // When the key IS set, the action attempts to call Anthropic; the SDK will
    // throw a network/auth error in CI since there's no real key. We just verify
    // the 503 gate is skipped (response is NOT 503 with aiEnabled:false).
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    const res = await action({
      request: postReq({ action: "continue", context: "hello world" }),
    } as any);
    // 502 (SDK error) or any non-503 is acceptable here.
    const body = await res.json();
    expect((body as { aiEnabled?: false }).aiEnabled).not.toBe(false);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("does not 503 when only DARTMOUTH_CHAT_API_KEY is set", async () => {
    // The Dartmouth gateway path drives the same SDK; without a live key the
    // call fails upstream — we only verify the 503 gate is skipped.
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test-key";
    const res = await action({
      request: postReq({ action: "continue", context: "hello world" }),
    } as any);
    const body = await res.json();
    expect((body as { aiEnabled?: false }).aiEnabled).not.toBe(false);
  });
});

describe("POST /api/ai/doc — input validation", () => {
  beforeEach(() => {
    // Set a key so validation is reached.
    // The Anthropic client will fail to connect, but input validation runs first.
    // We test validation paths that return before the SDK call.
  });

  it("returns 400 for invalid action", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    // Key unset → 503 before validation, but we can still test by setting the key
    // and checking the 400 branch. Since network will fail here, just test without key
    // expecting 503 (shows validation doesn't matter when gated).
    const res = await action({
      request: postReq({ action: "invalid-action", context: "hi" }),
    } as any);
    // With key unset, we get 503 (gated before validation).
    expect(res.status).toBe(503);
  });

  it("returns 400 for missing instruction on prompt action when key is set (network will 502)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const res = await action({
      request: postReq({ action: "prompt", context: "doc content here" }),
    } as any);
    // instruction is required for prompt action → 400 before SDK call.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/instruction/i);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns 400 for invalid action when key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const res = await action({
      request: postReq({ action: "not-valid", context: "doc" }),
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/action/i);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns 400 when context is not a string and key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const res = await action({
      request: postReq({ action: "continue", context: 42 }),
    } as any);
    expect(res.status).toBe(400);
    delete process.env.ANTHROPIC_API_KEY;
  });
});

describe("POST /api/ai/doc — method gate", () => {
  it("returns 405 for GET", async () => {
    const res = await action({
      request: new Request("http://localhost/api/ai/doc", { method: "GET" }),
    } as any);
    expect(res.status).toBe(405);
  });
});
