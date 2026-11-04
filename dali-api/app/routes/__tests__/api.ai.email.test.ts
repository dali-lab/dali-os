import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/ai.server", () => ({ generateShortText: vi.fn() }));
vi.mock("~/lib/ai-usage.server", () => ({ recordTokenUsage: vi.fn() }));
vi.mock("~/email/lib/access.server", () => ({
  findReadableAccount: vi.fn(),
  readableMailAccounts: vi.fn(),
  mailAccountLabel: (a: { displayName: string | null }) => a.displayName ?? "Account",
}));
vi.mock("~/email/lib/gmail-mailbox.server", () => {
  class MailboxError extends Error {}
  return { MailboxError, getMailboxToken: vi.fn(), getThread: vi.fn() };
});

import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { generateShortText } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { _resetForTests as resetRateLimits } from "~/lib/rate-limit";
import { findReadableAccount, readableMailAccounts } from "~/email/lib/access.server";
import { MailboxError, getMailboxToken, getThread } from "~/email/lib/gmail-mailbox.server";
import { action } from "~/routes/api.ai.email";

const post = (body: unknown, method = "POST") =>
  action({
    request: new Request("http://localhost/api/ai/email", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "ada" } } as never);
  vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 1 } as never);
  vi.mocked(generateShortText).mockResolvedValue({
    text: "Hello there",
    inputTokens: 12,
    outputTokens: 7,
  });
});

describe("gating", () => {
  it("returns the auth failure", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);
    expect((await post({ task: "draft" })).status).toBe(401);
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("rejects non-POST with 405", async () => {
    expect((await post({}, "GET")).status).toBe(405);
  });

  it("burst-limits a user to 10 requests a minute with Retry-After", async () => {
    for (let i = 0; i < 10; i++) expect((await post({ task: "draft" })).status).toBe(200);
    const res = await post({ task: "draft" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(generateShortText).toHaveBeenCalledTimes(10);
  });

  it("enforces the 200/day quota before calling the model", async () => {
    vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 201 } as never);
    const res = await post({ task: "draft" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("allows exactly the 200th request of the day", async () => {
    vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 200 } as never);
    expect((await post({ task: "draft" })).status).toBe(200);
  });

  it("increments the daily counter for this user and day", async () => {
    await post({ task: "draft" });
    const day = new Date().toISOString().slice(0, 10);
    expect(prisma.aiUsage.upsert).toHaveBeenCalledWith({
      where: { userId_day: { userId: "ada", day } },
      create: { userId: "ada", day, count: 1 },
      update: { count: { increment: 1 } },
    });
  });
});

describe("input validation", () => {
  it("rejects invalid JSON", async () => {
    expect((await post("{nope")).status).toBe(400);
  });

  it("rejects unknown tasks", async () => {
    const res = await post({ task: "summarize", text: "x" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown task" });
  });

  it.each(["rephrase", "proofread", "translate", "search"])("%s requires text", async (task) => {
    const res = await post({ task, text: "   " });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Nothing to work on" });
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("allows draft without text", async () => {
    expect((await post({ task: "draft", instruction: "thank them" })).status).toBe(200);
  });

  it("truncates text to 20,000 characters", async () => {
    await post({ task: "rephrase", text: "a".repeat(25_000) });
    const { prompt } = vi.mocked(generateShortText).mock.calls[0]![0];
    expect(prompt).toContain("a".repeat(20_000));
    expect(prompt).not.toContain("a".repeat(20_001));
  });
});

describe("writing tasks", () => {
  it("returns the generated text and records token usage", async () => {
    const res = await post({ task: "rephrase", text: "hi", instruction: "warmer" });
    expect(await res.json()).toEqual({ text: "Hello there" });
    expect(vi.mocked(generateShortText).mock.calls[0]![0].prompt).toContain("warmer");
    const day = new Date().toISOString().slice(0, 10);
    expect(recordTokenUsage).toHaveBeenCalledWith("ada", day, 12, 7);
  });

  it("gives blog-post passages a larger token budget than emails", async () => {
    await post({ task: "rephrase", text: "hi", surface: "post" });
    await post({ task: "rephrase", text: "hi", surface: "bogus" });
    expect(vi.mocked(generateShortText).mock.calls[0]![0].maxTokens).toBe(4000);
    expect(vi.mocked(generateShortText).mock.calls[1]![0].maxTokens).toBe(1500);
  });

  it("returns 503 when no AI provider is configured", async () => {
    vi.mocked(generateShortText).mockResolvedValue(null as never);
    const res = await post({ task: "draft" });
    expect(res.status).toBe(503);
    expect(recordTokenUsage).not.toHaveBeenCalled();
  });

  it("404s when the thread's account is not readable by the user", async () => {
    vi.mocked(findReadableAccount).mockResolvedValue(null as never);
    const res = await post({ task: "draft", accountId: "acc1", threadId: "t1" });
    expect(res.status).toBe(404);
    expect(findReadableAccount).toHaveBeenCalledWith("ada", "acc1", expect.any(Request));
    expect(getThread).not.toHaveBeenCalled();
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("includes the thread in the prompt when the account is readable", async () => {
    vi.mocked(findReadableAccount).mockResolvedValue({ id: "acc1" } as never);
    vi.mocked(getMailboxToken).mockResolvedValue("tok" as never);
    vi.mocked(getThread).mockResolvedValue([
      { from: "grace@example.edu", date: "2026-11-01", text: "Can we meet?", html: null },
    ] as never);
    await post({ task: "draft", accountId: "acc1", threadId: "t1" });
    expect(vi.mocked(generateShortText).mock.calls[0]![0].prompt).toContain("Can we meet?");
  });

  it("returns 502 when Gmail cannot supply the thread, without spending quota", async () => {
    vi.mocked(findReadableAccount).mockResolvedValue({ id: "acc1" } as never);
    vi.mocked(getMailboxToken).mockResolvedValue("tok" as never);
    vi.mocked(getThread).mockRejectedValue(new MailboxError("gone"));
    const res = await post({ task: "draft", accountId: "acc1", threadId: "t1" });
    expect(res.status).toBe(502);
    expect(prisma.aiUsage.upsert).not.toHaveBeenCalled();
  });

  it("rethrows non-mailbox errors while reading the thread", async () => {
    vi.mocked(findReadableAccount).mockResolvedValue({ id: "acc1" } as never);
    vi.mocked(getMailboxToken).mockRejectedValue(new Error("boom"));
    await expect(post({ task: "draft", accountId: "acc1", threadId: "t1" })).rejects.toThrow("boom");
  });
});

describe("search task", () => {
  beforeEach(() => {
    vi.mocked(readableMailAccounts).mockResolvedValue([
      { id: "a1", address: "ada@example.edu", displayName: "Ada", archived: false },
      { id: "a2", address: "old@example.edu", displayName: "Old", archived: true },
    ] as never);
  });

  it("keeps only readable, unarchived account ids from the model's answer", async () => {
    vi.mocked(generateShortText).mockResolvedValue({
      text: 'Sure: {"query":" from:grace ","accounts":["a1","a2","not-mine"]}',
      inputTokens: 1,
      outputTokens: 1,
    });
    const res = await post({ task: "search", text: "grace's emails" });
    expect(await res.json()).toEqual({ query: "from:grace", accounts: ["a1"] });
    expect(readableMailAccounts).toHaveBeenCalledWith("ada", expect.any(Request));
  });

  it("falls back to the raw text when the model's reply is unparseable", async () => {
    vi.mocked(generateShortText).mockResolvedValue({
      text: "no json here",
      inputTokens: 1,
      outputTokens: 1,
    });
    const res = await post({ task: "search", text: "grace's emails" });
    expect(await res.json()).toEqual({ query: "grace's emails", accounts: [] });
  });
});

describe("provider errors", () => {
  it("maps Anthropic API errors to 'AI service error' (502)", async () => {
    vi.mocked(generateShortText).mockRejectedValue(
      new Anthropic.APIError(500, {}, "upstream", new Headers()),
    );
    const res = await post({ task: "draft" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "AI service error" });
  });

  it("maps other failures to 'AI request failed' (502)", async () => {
    vi.mocked(generateShortText).mockRejectedValue(new Error("network"));
    const res = await post({ task: "draft" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "AI request failed" });
  });
});
