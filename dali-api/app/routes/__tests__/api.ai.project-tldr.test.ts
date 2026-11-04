import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/ai.server", () => ({ generateShortText: vi.fn() }));
vi.mock("~/lib/ai-usage.server", () => ({ recordTokenUsage: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/projects/lib/project-status", () => ({
  computeProjectStatus: vi.fn(),
  buildTldrDetail: vi.fn(),
  factsFingerprint: vi.fn(),
}));

import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { generateShortText } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { _resetForTests as resetRateLimits } from "~/lib/rate-limit";
import {
  computeProjectStatus,
  buildTldrDetail,
  factsFingerprint,
} from "~/projects/lib/project-status";
import { action } from "~/routes/api.ai.project-tldr";

const m = prisma as any;
const HOUR = 3_600_000;

const post = (body: unknown, method = "POST") =>
  action({
    request: new Request("http://localhost/api/ai/project-tldr", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as never) as Promise<Response>;

const project = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Deserto",
  status: "Active",
  aiTldr: null,
  aiTldrGeneratedAt: null,
  aiTldrInputHash: null,
  tasks: [],
  projectTerms: [
    {
      term: {
        code: "26F",
        startDate: new Date("2026-09-14T00:00:00Z"),
        endDate: new Date("2026-11-20T00:00:00Z"),
        sortKey: 2,
      },
    },
    {
      term: {
        code: "26S",
        startDate: new Date("2026-03-30T00:00:00Z"),
        endDate: new Date("2026-06-05T00:00:00Z"),
        sortKey: 1,
      },
    },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "ada" } } as never);
  vi.mocked(getUserRoles).mockResolvedValue(["Member"] as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  m.project = {
    findUnique: vi.fn().mockResolvedValue(project()),
    update: vi.fn().mockResolvedValue({}),
  };
  vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 1 } as never);
  vi.mocked(computeProjectStatus).mockReturnValue({
    hasWork: true,
    projectStatus: "Active",
    doneTasks: 1,
    totalTasks: 4,
    overdue: 0,
    unscheduled: 0,
    inReview: 0,
    stale: 0,
    activeSprint: null,
  } as never);
  vi.mocked(buildTldrDetail).mockReturnValue({
    overdue: [],
    stale: [],
    inReview: [],
    teamSize: 2,
    urgentOpen: 0,
    highOpen: 0,
    unscheduledHighPriority: 0,
  } as never);
  vi.mocked(factsFingerprint).mockReturnValue("fp-1");
  vi.mocked(generateShortText).mockResolvedValue({
    text: "Focus on review.",
    inputTokens: 30,
    outputTokens: 9,
  });
});

describe("gating", () => {
  it("returns the auth failure", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);
    expect((await post({ projectId: "p1" })).status).toBe(401);
  });

  it("rejects non-POST with 405", async () => {
    expect((await post({}, "GET")).status).toBe(405);
  });

  it("burst-limits to 10 requests a minute per user", async () => {
    for (let i = 0; i < 10; i++) await post({ projectId: "p1" });
    const res = await post({ projectId: "p1" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("rejects invalid JSON and a missing projectId", async () => {
    expect((await post("{nope")).status).toBe(400);
    const res = await post({});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "projectId is required" });
    expect((await post({ projectId: 5 })).status).toBe(400);
  });

  it("is forbidden when the project-tldr-ai flag is off for this user, before any project read", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const res = await post({ projectId: "p1" });
    expect(res.status).toBe(403);
    expect(isFeatureEnabled).toHaveBeenCalledWith(
      "project-tldr-ai",
      "ada",
      ["Member"],
      expect.any(Request),
    );
    expect(m.project.findUnique).not.toHaveBeenCalled();
  });

  it("404s for an unknown project", async () => {
    m.project.findUnique.mockResolvedValue(null);
    expect((await post({ projectId: "nope" })).status).toBe(404);
  });
});

describe("generation and cache", () => {
  it("returns a null summary without calling the model when there is no work", async () => {
    vi.mocked(computeProjectStatus).mockReturnValue({ hasWork: false } as never);
    const res = await post({ projectId: "p1" });
    expect(await res.json()).toEqual({ tldr: null, generatedAt: null });
    expect(generateShortText).not.toHaveBeenCalled();
    expect(prisma.aiUsage.upsert).not.toHaveBeenCalled();
  });

  it("orders terms oldest first when computing status", async () => {
    await post({ projectId: "p1" });
    const input = vi.mocked(computeProjectStatus).mock.calls[0]![0] as any;
    expect(input.terms.map((t: any) => t.code)).toEqual(["26S", "26F"]);
    expect(input.projectStatus).toBe("Active");
  });

  it("serves a fresh cached summary when the fingerprint matches, without spending quota", async () => {
    const at = new Date(Date.now() - HOUR);
    m.project.findUnique.mockResolvedValue(
      project({ aiTldr: "Cached.", aiTldrGeneratedAt: at, aiTldrInputHash: "fp-1" }),
    );
    const res = await post({ projectId: "p1" });
    expect(await res.json()).toEqual({ tldr: "Cached.", generatedAt: at.toISOString() });
    expect(generateShortText).not.toHaveBeenCalled();
    expect(prisma.aiUsage.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["the fingerprint changed", { aiTldrInputHash: "old" }, {}],
    [
      "the cache is older than 24 hours",
      { aiTldrGeneratedAt: new Date(Date.now() - 25 * HOUR) },
      {},
    ],
    ["force is true", {}, { force: true }],
  ])("regenerates when %s", async (_n, projOver, bodyOver) => {
    m.project.findUnique.mockResolvedValue(
      project({
        aiTldr: "Cached.",
        aiTldrGeneratedAt: new Date(Date.now() - HOUR),
        aiTldrInputHash: "fp-1",
        ...projOver,
      }),
    );
    const res = await post({ projectId: "p1", ...bodyOver });
    expect((await res.json()).tldr).toBe("Focus on review.");
    expect(generateShortText).toHaveBeenCalledTimes(1);
  });

  it("generates, caches on the project with the fingerprint, and records token usage", async () => {
    const res = await post({ projectId: "p1" });
    const body = await res.json();
    expect(body.tldr).toBe("Focus on review.");
    const day = new Date().toISOString().slice(0, 10);
    const call = m.project.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "p1" });
    expect(call.data.aiTldr).toBe("Focus on review.");
    expect(call.data.aiTldrInputHash).toBe("fp-1");
    expect(call.data.aiTldrGeneratedAt.toISOString()).toBe(body.generatedAt);
    expect(recordTokenUsage).toHaveBeenCalledWith("ada", day, 30, 9);
    expect(vi.mocked(generateShortText).mock.calls[0]![0].maxTokens).toBe(400);
    expect(vi.mocked(generateShortText).mock.calls[0]![0].task).toBe("projectTldr");
    expect(vi.mocked(generateShortText).mock.calls[0]![0].prompt).toContain('Project "Deserto"');
  });

  it("enforces the 200/day quota before calling the model", async () => {
    vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 201 } as never);
    const res = await post({ projectId: "p1" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(generateShortText).not.toHaveBeenCalled();
    expect(m.project.update).not.toHaveBeenCalled();
  });

  it("returns 503 {aiEnabled:false} and caches nothing when no provider is configured", async () => {
    vi.mocked(generateShortText).mockResolvedValue(null as never);
    const res = await post({ projectId: "p1" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ aiEnabled: false });
    expect(m.project.update).not.toHaveBeenCalled();
  });

  it("maps Anthropic API errors and other failures to 502", async () => {
    vi.mocked(generateShortText).mockRejectedValueOnce(
      new Anthropic.APIError(500, {}, "upstream", new Headers()),
    );
    const a = await post({ projectId: "p1" });
    expect(a.status).toBe(502);
    expect(await a.json()).toEqual({ error: "AI service error" });

    vi.mocked(generateShortText).mockRejectedValueOnce(new Error("net"));
    const b = await post({ projectId: "p1" });
    expect(b.status).toBe(502);
    expect(await b.json()).toEqual({ error: "AI request failed" });
    expect(m.project.update).not.toHaveBeenCalled();
  });
});
