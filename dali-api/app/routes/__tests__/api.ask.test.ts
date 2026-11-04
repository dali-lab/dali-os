import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getUserRoles: vi.fn(),
  isFeatureEnabled: vi.fn(),
  resolveAiProvider: vi.fn(),
  claimAskQuota: vi.fn(),
  recordTokenUsage: vi.fn(),
  checkRateLimit: vi.fn(),
  runAsk: vi.fn(),
  findUser: vi.fn(),
}));

vi.mock("~/lib/auth", () => ({ requireAuth: h.requireAuth }));
vi.mock("~/lib/roles", () => ({ getUserRoles: h.getUserRoles }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: h.isFeatureEnabled }));
vi.mock("~/lib/ai.server", () => ({ resolveAiProvider: h.resolveAiProvider }));
vi.mock("~/lib/ai-usage.server", () => ({ recordTokenUsage: h.recordTokenUsage }));
vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("~/lib/db.server", () => ({ prisma: { user: { findUnique: h.findUser } } }));
vi.mock("~/ask/loop.server", () => ({ runAsk: h.runAsk }));
vi.mock("~/lib/ai-quota.server", async () => {
  const quotaResponse = (r: { error: string; retryAfterSeconds: number }) =>
    Response.json({ error: r.error }, { status: 429, headers: { "Retry-After": String(r.retryAfterSeconds) } });
  return { claimAskQuota: h.claimAskQuota, aiQuotaResponse: quotaResponse };
});

import { action, ASK_QUESTION_MAX } from "../api.ask";

const USER = {
  id: "u1",
  daliEmail: "ada@dali.example.edu",
  dartmouthEmail: null,
  netId: "f00001",
  firstName: "Ada",
  lastName: "Lovelace",
};
const PROVIDER = { name: "dartmouth", askModel: "anthropic.claude-sonnet-5-5" };

function post(body: unknown, init: RequestInit = {}) {
  const request = new Request("http://x/api/ask", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
  return action({ request } as Parameters<typeof action>[0]) as Promise<Response>;
}

async function events(res: Response) {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));
}

beforeEach(() => {
  vi.resetAllMocks();
  h.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  h.getUserRoles.mockResolvedValue({ isLabMember: true });
  h.isFeatureEnabled.mockResolvedValue(true);
  h.checkRateLimit.mockReturnValue(null);
  h.resolveAiProvider.mockReturnValue(PROVIDER);
  h.findUser.mockResolvedValue(USER);
  h.claimAskQuota.mockResolvedValue({ ok: true, day: "2026-11-04" });
  h.runAsk.mockImplementation(async (opts) => {
    opts.emit({ type: "status", label: "Searching" });
    opts.emit({ type: "done", answer: "May 4 [1].", sources: [] });
    opts.usage.inputTokens = 900;
    opts.usage.outputTokens = 80;
    return opts.usage;
  });
});

describe("POST /api/ask gates", () => {
  it("rejects other methods", async () => {
    const res = await action({ request: new Request("http://x/api/ask") } as Parameters<typeof action>[0]);
    expect((res as Response).status).toBe(405);
  });

  it("returns the auth failure as is", async () => {
    const denied = new Response(null, { status: 401 });
    h.requireAuth.mockResolvedValue({ ok: false, response: denied });
    expect(await post({ question: "x" })).toBe(denied);
  });

  it("is closed to people who aren't lab members, even with the flag on", async () => {
    h.getUserRoles.mockResolvedValue({ isLabMember: false, isAlumni: true });
    expect((await post({ question: "x" })).status).toBe(403);
    expect(h.claimAskQuota).not.toHaveBeenCalled();
  });

  it("is closed while the ask-dali flag is off for the member", async () => {
    h.isFeatureEnabled.mockResolvedValue(false);
    expect((await post({ question: "x" })).status).toBe(403);
    expect(h.isFeatureEnabled).toHaveBeenCalledWith("ask-dali", "u1", { isLabMember: true }, expect.any(Request));
  });

  it("limits bursts per member", async () => {
    h.checkRateLimit.mockReturnValue(new Response(null, { status: 429, headers: { "Retry-After": "12" } }));
    const res = await post({ question: "x" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    expect(await res.json()).toEqual({ error: "You're asking too quickly. Try again in 12s." });
    expect(h.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), { max: 10, windowMs: 60_000 }, "ask:u1");
  });

  it("returns 503 without a provider", async () => {
    h.resolveAiProvider.mockReturnValue(null);
    expect((await post({ question: "x" })).status).toBe(503);
  });

  it.each([
    ["invalid JSON", "{nope", "Invalid JSON"],
    ["a missing question", {}, "Ask a question first."],
    ["a blank question", { question: "   " }, "Ask a question first."],
    ["a long question", { question: "x".repeat(ASK_QUESTION_MAX + 1) }, `Keep questions under ${ASK_QUESTION_MAX} characters.`],
    ["history that doesn't start with the member", { question: "x", history: [{ role: "assistant", content: "hi" }] }, "history must start with a user entry"],
  ])("rejects %s with 400 and spends no quota", async (_label, body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(h.claimAskQuota).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After once the daily quota is used, without asking the model", async () => {
    h.claimAskQuota.mockResolvedValue({ ok: false, error: "limit", retryAfterSeconds: 600 });
    const res = await post({ question: "x" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("600");
    expect(h.runAsk).not.toHaveBeenCalled();
  });
});

describe("POST /api/ask stream", () => {
  it("streams the loop's events as SSE", async () => {
    const res = await post({ question: "  When is the launch?  " });
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await events(res)).toEqual([
      { type: "status", label: "Searching" },
      { type: "done", answer: "May 4 [1].", sources: [] },
    ]);
  });

  it("runs as the member with read-only scope and an Ask audit identity", async () => {
    await (await post({ question: "When is the launch?", history: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }] })).text();
    const opts = h.runAsk.mock.calls[0][0];
    expect(opts.provider).toBe(PROVIDER);
    expect(opts.question).toBe("When is the launch?");
    expect(opts.history).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
    expect(opts.caller).toEqual({
      user: USER,
      scopes: ["mcp:read"],
      request: expect.any(Request),
      origin: "ask",
      clientId: "ask-dali",
      clientName: "Ask DALI",
      grantId: null,
    });
  });

  it("records the turn's tokens on the day's usage row", async () => {
    await (await post({ question: "x" })).text();
    expect(h.recordTokenUsage).toHaveBeenCalledWith("u1", "2026-11-04", 900, 80);
  });

  it("sends a plain error event when the loop fails and still records what was spent", async () => {
    h.runAsk.mockImplementation(async (opts) => {
      opts.usage.inputTokens = 300;
      throw new Error("gateway exploded: secret detail");
    });
    const res = await post({ question: "x" });
    const out = await events(res);
    expect(out).toEqual([{ type: "error", message: "Something went wrong. Try again." }]);
    expect(JSON.stringify(out)).not.toContain("secret detail");
    expect(h.recordTokenUsage).toHaveBeenCalledWith("u1", "2026-11-04", 300, 0);
  });

  it("refuses a session whose user row is gone", async () => {
    h.findUser.mockResolvedValue(null);
    expect((await post({ question: "x" })).status).toBe(403);
    expect(h.claimAskQuota).not.toHaveBeenCalled();
  });
});
