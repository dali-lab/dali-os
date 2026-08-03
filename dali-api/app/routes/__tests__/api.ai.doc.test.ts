// Tests for POST /api/ai/doc (new streaming + conversation contract).
// Focuses on gating (auth, missing key, bad input) and the pure history
// validator, since the Anthropic SDK call itself requires a live key.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/db");

// These tests drive the real action, which builds an Anthropic client and
// calls it once a provider key is set — so without this stub the suite makes
// live HTTPS requests. api.anthropic.com 401s quickly; chat.dartmouth.edu is
// off-campus-unreachable from CI and the call hangs past Vitest's 5s timeout,
// which is what made the Dartmouth key-gate test fail intermittently. Nothing
// here asserts on provider output — the API surface is what's under test — so
// the stub just fails the call the way a bad key would.
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    constructor(readonly status = 401, message = "stubbed SDK: no live key") {
      super(message);
    }
  }
  class Anthropic {
    static APIError = APIError;
    messages = {
      create: vi.fn().mockRejectedValue(new APIError()),
      stream: vi.fn(() => {
        throw new APIError();
      }),
    };
  }
  return { default: Anthropic, APIError };
});

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { _resetForTests as resetRateLimits } from "~/lib/rate-limit";
import {
  action,
  recordTokenUsage,
  validateHistory,
} from "~/routes/api.ai.doc";

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

function postReq(body: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/ai/doc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK);
  // All tests share user u1 — reset the in-memory burst counter so earlier
  // tests can't trip the 10/min gate for later ones.
  resetRateLimits();
  // Default: first request of the day, well under the daily quota.
  vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({
    id: "au1",
    userId: "u1",
    day: "2026-08-01",
    count: 1,
  } as never);
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

// ── Auth gate ─────────────────────────────────────────────────────────────────

describe("POST /api/ai/doc — auth gate", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AUTH_FAIL);
    const res = await action({
      request: postReq({ instruction: "hi" }),
    } as any);
    expect(res.status).toBe(401);
  });
});

// ── Key gate (503) ────────────────────────────────────────────────────────────

describe("POST /api/ai/doc — key gate", () => {
  it("returns 503 with aiEnabled:false when no provider key is set", async () => {
    const res = await action({
      request: postReq({ instruction: "hello world" }),
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
      request: postReq({ instruction: "hello world" }),
    } as any);
    const body = await res.json();
    expect((body as { aiEnabled?: false }).aiEnabled).not.toBe(false);
  });

  it("does not 503 when only DARTMOUTH_CHAT_API_KEY is set", async () => {
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test-key";
    const res = await action({
      request: postReq({ instruction: "hello world" }),
    } as any);
    const body = await res.json();
    expect((body as { aiEnabled?: false }).aiEnabled).not.toBe(false);
  });
});

// ── Method gate ───────────────────────────────────────────────────────────────

describe("POST /api/ai/doc — method gate", () => {
  it("returns 405 for GET", async () => {
    const res = await action({
      request: new Request("http://localhost/api/ai/doc", { method: "GET" }),
    } as any);
    expect(res.status).toBe(405);
  });
});

// ── Burst rate limit (10/min per user, in-memory) ────────────────────────────

describe("POST /api/ai/doc — burst rate limit", () => {
  it("returns 429 with Retry-After on the 11th request in a minute", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await action({ request: postReq({ instruction: "hi" }) } as any);
      expect(res.status).not.toBe(429);
    }
    const res = await action({ request: postReq({ instruction: "hi" }) } as any);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = await res.json();
    expect(body.error).toMatch(/too quickly/i);
  });

  it("fires before the provider gate (429, not 503, even with no key set)", async () => {
    // No provider key in this test — a 429 instead of 503 proves the burst
    // gate short-circuits before any provider work.
    for (let i = 0; i < 10; i++) {
      await action({ request: postReq({ instruction: "hi" }) } as any);
    }
    const res = await action({ request: postReq({ instruction: "hi" }) } as any);
    expect(res.status).toBe(429);
  });

  it("is keyed per user", async () => {
    for (let i = 0; i < 10; i++) {
      await action({ request: postReq({ instruction: "hi" }) } as any);
    }
    vi.mocked(requireAuth).mockResolvedValue({
      ...AUTH_OK,
      user: { ...AUTH_OK.user, sub: "u2" },
    });
    const res = await action({ request: postReq({ instruction: "hi" }) } as any);
    expect(res.status).not.toBe(429);
  });
});

// ── Daily quota (200/day per user, Postgres-backed) ──────────────────────────

describe("POST /api/ai/doc — daily quota", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  });

  it("returns 429 with the daily message once the quota is exceeded", async () => {
    vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({
      id: "au1",
      userId: "u1",
      day: "2026-08-01",
      count: 201,
    } as never);
    const res = await action({ request: postReq({ instruction: "hi" }) } as any);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = await res.json();
    expect(body.error).toMatch(/daily|today's/i);
  });

  it("proceeds at exactly the quota (count == 200)", async () => {
    vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({
      id: "au1",
      userId: "u1",
      day: "2026-08-01",
      count: 200,
    } as never);
    const res = await action({
      request: postReq({ instruction: "hi", stream: true }),
    } as any);
    expect(res.status).not.toBe(429);
  });

  it("increments via upsert keyed on userId + UTC day", async () => {
    await action({
      request: postReq({ instruction: "hi", stream: true }),
    } as any);
    expect(prisma.aiUsage.upsert).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.aiUsage.upsert).mock.calls[0][0];
    expect(arg.where.userId_day).toEqual({
      userId: "u1",
      day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(arg.update).toEqual({ count: { increment: 1 } });
  });

  it("does not consume quota on invalid requests (400s)", async () => {
    const res = await action({
      request: postReq({ instruction: "" }),
    } as any);
    expect(res.status).toBe(400);
    expect(prisma.aiUsage.upsert).not.toHaveBeenCalled();
  });

  it("does not consume quota when no provider key is set (503)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await action({ request: postReq({ instruction: "hi" }) } as any);
    expect(res.status).toBe(503);
    expect(prisma.aiUsage.upsert).not.toHaveBeenCalled();
  });
});

// ── Token accounting ─────────────────────────────────────────────────────────

describe("recordTokenUsage", () => {
  it("increments the day row's token counters", async () => {
    await recordTokenUsage("u1", "2026-08-01", 120, 456);
    expect(prisma.aiUsage.update).toHaveBeenCalledWith({
      where: { userId_day: { userId: "u1", day: "2026-08-01" } },
      data: {
        inputTokens: { increment: 120 },
        outputTokens: { increment: 456 },
      },
    });
  });

  it("skips the write when both counts are zero", async () => {
    await recordTokenUsage("u1", "2026-08-01", 0, 0);
    expect(prisma.aiUsage.update).not.toHaveBeenCalled();
  });

  it("writes when only output tokens are known", async () => {
    await recordTokenUsage("u1", "2026-08-01", 0, 42);
    expect(prisma.aiUsage.update).toHaveBeenCalledTimes(1);
  });

  it("never throws when the DB write fails", async () => {
    vi.mocked(prisma.aiUsage.update).mockRejectedValueOnce(
      new Error("db down"),
    );
    await expect(
      recordTokenUsage("u1", "2026-08-01", 1, 1),
    ).resolves.toBeUndefined();
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("POST /api/ai/doc — input validation", () => {
  beforeEach(() => {
    // Set a key so validation is reached before the 503 gate.
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  });

  it("returns 400 when instruction is missing", async () => {
    const res = await action({
      request: postReq({ context: "some context" }),
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/instruction/i);
  });

  it("returns 400 when instruction is empty string", async () => {
    const res = await action({
      request: postReq({ instruction: "   " }),
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/instruction/i);
  });

  it("returns 400 when instruction is not a string", async () => {
    const res = await action({
      request: postReq({ instruction: 42 }),
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/instruction/i);
  });

  it("accepts a valid instruction with no context or history (SDK call will 502)", async () => {
    const res = await action({
      request: postReq({ instruction: "Write a summary" }),
    } as any);
    // Should NOT be 400 or 503 — reaches SDK, which will fail with 502 in CI
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(503);
  });

  it("returns 400 when history has more than 12 entries", async () => {
    const history = Array.from({ length: 13 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "msg",
    }));
    const res = await action({
      request: postReq({ instruction: "hi", history }),
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/12/);
  });

  it("returns 400 when history starts with an assistant entry", async () => {
    const res = await action({
      request: postReq({
        instruction: "hi",
        history: [{ role: "assistant", content: "oops" }],
      }),
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/user/i);
  });

  it("returns 400 when history roles do not alternate", async () => {
    const res = await action({
      request: postReq({
        instruction: "hi",
        history: [
          { role: "user", content: "first" },
          { role: "user", content: "second" }, // should be assistant
        ],
      }),
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/alternate/i);
  });

  it("returns 400 when a history entry is missing role", async () => {
    const res = await action({
      request: postReq({
        instruction: "hi",
        history: [{ content: "no role" }],
      }),
    } as any);
    expect(res.status).toBe(400);
  });

  it("returns 400 when history is not an array", async () => {
    const res = await action({
      request: postReq({
        instruction: "hi",
        history: "not an array",
      }),
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/array/i);
  });
});

// ── Streaming gate ────────────────────────────────────────────────────────────

describe("POST /api/ai/doc — stream:true gate", () => {
  it("with a key set, stream:true responds with text/event-stream (or 502 if SDK fails, not 503/400)", async () => {
    // The SSE response starts with 200 text/event-stream BEFORE SDK call outcomes.
    // With a fake key the SDK will fail, but the error ends up as an SSE event,
    // not as a different HTTP status — so we just verify the response is NOT 503/400.
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const res = await action({
      request: postReq({ instruction: "Write something", stream: true }),
    } as any);
    // Content-type should be text/event-stream OR this is some other non-503/400 response.
    expect(res.status).not.toBe(503);
    expect(res.status).not.toBe(400);
    const ct = res.headers.get("content-type") ?? "";
    // Either SSE or a 502 JSON error (if the stream setup itself threw pre-response).
    expect(ct.includes("text/event-stream") || res.status === 502).toBe(true);
  });

  it("stream:true gating still returns 503 JSON (not SSE) when no key", async () => {
    const res = await action({
      request: postReq({ instruction: "hi", stream: true }),
    } as any);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ aiEnabled: false });
  });

  it("stream:true gating still returns 400 JSON (not SSE) for bad instruction", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const res = await action({
      request: postReq({ instruction: "", stream: true }),
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/instruction/i);
  });

  it("stream:true gating still returns 400 JSON (not SSE) for bad history", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const res = await action({
      request: postReq({
        instruction: "hi",
        stream: true,
        history: [{ role: "assistant", content: "bad" }],
      }),
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/user/i);
  });
});

// ── validateHistory (pure unit tests) ────────────────────────────────────────

describe("validateHistory", () => {
  it("returns ok with empty entries for undefined", () => {
    const r = validateHistory(undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entries).toEqual([]);
  });

  it("returns ok with empty entries for null", () => {
    const r = validateHistory(null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entries).toEqual([]);
  });

  it("returns ok with empty entries for empty array", () => {
    const r = validateHistory([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entries).toEqual([]);
  });

  it("returns ok for a valid alternating sequence", () => {
    const r = validateHistory([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
      { role: "user", content: "again" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entries).toHaveLength(3);
      expect(r.entries[0].role).toBe("user");
      expect(r.entries[1].role).toBe("assistant");
      expect(r.entries[2].role).toBe("user");
    }
  });

  it("caps each entry content at 8000 chars", () => {
    const long = "x".repeat(9000);
    const r = validateHistory([{ role: "user", content: long }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entries[0].content.length).toBe(8000);
  });

  it("rejects non-array", () => {
    const r = validateHistory("not an array");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/array/i);
  });

  it("rejects > 12 entries", () => {
    const entries = Array.from({ length: 13 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "msg",
    }));
    const r = validateHistory(entries);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/12/);
  });

  it("rejects when first entry is assistant", () => {
    const r = validateHistory([{ role: "assistant", content: "oops" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/user/i);
  });

  it("rejects non-alternating roles (user, user)", () => {
    const r = validateHistory([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/alternate/i);
  });

  it("rejects non-alternating roles (user, assistant, assistant)", () => {
    const r = validateHistory([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "assistant", content: "c" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/alternate/i);
  });

  it("rejects entry with invalid role", () => {
    const r = validateHistory([{ role: "system", content: "hi" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/role/i);
  });

  it("rejects entry where content is not a string", () => {
    const r = validateHistory([{ role: "user", content: 42 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/content/i);
  });

  it("rejects entry that is not an object", () => {
    const r = validateHistory(["not-an-object"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/object/i);
  });
});
