import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/tunnel-scores.server", () => ({
  MAX_SCORE: 999_999,
  MAX_DURATION_MS: 86_400_000,
  OBSTACLES: ["gap", "strip", "holes", "spiral"],
  RUN_ENDINGS: ["fall", "quit"],
  readLeaderboard: vi.fn(),
  recordScore: vi.fn(),
  logRun: vi.fn(),
}));

import { requireMemberSession } from "~/lib/auth";
import { logRun, readLeaderboard, recordScore } from "~/lib/tunnel-scores.server";
import { action, loader } from "~/routes/api.landing.tunnel-scores";

const URL = "http://os.test/api/landing/tunnel-scores";

function post(body: string, method = "POST") {
  return action({
    request: new Request(URL, { method, headers: { "Content-Type": "application/json" }, body }),
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as never);
  vi.mocked(readLeaderboard).mockResolvedValue({ entries: [], you: null });
  vi.mocked(recordScore).mockResolvedValue({ entries: [], you: null, personalBest: true });
});

describe("GET /api/landing/tunnel-scores", () => {
  it("returns the board for the signed-in member", async () => {
    const res = (await loader({ request: new Request(URL) } as never)) as Response;
    expect(res.status).toBe(200);
    expect(readLeaderboard).toHaveBeenCalledWith("u1");
  });

  it("turns away anyone who isn't a member", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const res = (await loader({ request: new Request(URL) } as never)) as Response;
    expect(res.status).toBe(403);
    expect(readLeaderboard).not.toHaveBeenCalled();
  });
});

describe("POST /api/landing/tunnel-scores", () => {
  it("records a run under the signed-in member", async () => {
    const res = await post(JSON.stringify({ score: 420 }));
    expect(res.status).toBe(200);
    expect(recordScore).toHaveBeenCalledWith("u1", { score: 420 });
    expect((await res.json()).personalBest).toBe(true);
  });

  it("accepts zero and the maximum", async () => {
    expect((await post(JSON.stringify({ score: 0 }))).status).toBe(200);
    expect((await post(JSON.stringify({ score: 999_999 }))).status).toBe(200);
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["over the max", 1_000_000],
    ["a string", "100"],
    ["missing", undefined],
  ])("rejects a score that is %s", async (_label, score) => {
    const res = await post(JSON.stringify({ score }));
    expect(res.status).toBe(400);
    expect(recordScore).not.toHaveBeenCalled();
  });

  it("rejects a null body", async () => {
    expect((await post("null")).status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    expect((await post("{")).status).toBe(400);
  });

  it("turns away anyone who isn't a member without recording", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await post(JSON.stringify({ score: 5 }))).status).toBe(401);
    expect(recordScore).not.toHaveBeenCalled();
  });

  it("only allows POST", async () => {
    expect((await post(JSON.stringify({ score: 5 }), "PUT")).status).toBe(405);
  });
});

describe("the run log", () => {
  it("logs a fall with its details and records it against the board", async () => {
    const res = await post(JSON.stringify({ score: 420, durationMs: 12_500, endedBy: "fall", obstacle: "strip" }));
    expect(res.status).toBe(200);
    expect(logRun).toHaveBeenCalledWith("u1", { score: 420, durationMs: 12_500, endedBy: "fall", obstacle: "strip" });
    expect(recordScore).toHaveBeenCalledWith("u1", { score: 420 });
  });

  it("logs a run left early without letting it set a best", async () => {
    const res = await post(JSON.stringify({ score: 900, durationMs: 30_000, endedBy: "quit", obstacle: "gap" }));
    expect(res.status).toBe(200);
    expect(logRun).toHaveBeenCalledWith("u1", { score: 900, durationMs: 30_000, endedBy: "quit", obstacle: null });
    expect(recordScore).not.toHaveBeenCalled();
    expect((await res.json()).personalBest).toBe(false);
  });

  it("reads a bare score from an older client as a fall with no details", async () => {
    await post(JSON.stringify({ score: 7 }));
    expect(logRun).toHaveBeenCalledWith("u1", { score: 7, durationMs: null, endedBy: "fall", obstacle: null });
  });

  it.each([
    ["an unknown ending", { score: 1, endedBy: "won" }],
    ["an unknown obstacle", { score: 1, obstacle: "lava" }],
    ["a negative duration", { score: 1, durationMs: -1 }],
    ["a duration over a day", { score: 1, durationMs: 86_400_001 }],
    ["a fractional duration", { score: 1, durationMs: 1.5 }],
  ])("rejects %s without logging", async (_label, body) => {
    expect((await post(JSON.stringify(body))).status).toBe(400);
    expect(logRun).not.toHaveBeenCalled();
  });

  it("logs nothing for someone who isn't a member", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    await post(JSON.stringify({ score: 5 }));
    expect(logRun).not.toHaveBeenCalled();
  });
});
