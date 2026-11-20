import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/db.server", () => ({
  prisma: { tunnelRun: { aggregate: vi.fn() } },
}));
vi.mock("~/admin/lib/tunnel-runs.server", () => ({
  loadTunnelRunAggregates: vi.fn(),
  loadTunnelRunsPerDay: vi.fn(),
}));
vi.mock("~/admin/lib/people.server", () => ({ loadPeopleById: vi.fn() }));

import { loadPeopleById } from "~/admin/lib/people.server";
import { loadTunnelRunAggregates, loadTunnelRunsPerDay } from "~/admin/lib/tunnel-runs.server";
import { SCORE_BUCKETS, type TunnelRunAggregates } from "~/admin/lib/tunnel-runs";
import { loader } from "~/admin/routes/admin.games";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";

const load = (url = "http://os.test/admin/insights/games") =>
  loader({ request: new Request(url), params: {}, context: {} } as never);

const aggregates = (o: Partial<TunnelRunAggregates> = {}): TunnelRunAggregates => ({
  totals: { runs: 0, quits: 0, bestScore: null, medianScore: null, medianDurationMs: null },
  endings: [],
  scoreBucketCounts: SCORE_BUCKETS.map(() => 0),
  players: [],
  learning: { firstRunMedian: null, laterRunMedian: null, laterRuns: 0 },
  ...o,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(loadTunnelRunAggregates).mockResolvedValue(aggregates());
  vi.mocked(loadTunnelRunsPerDay).mockResolvedValue(new Map());
  vi.mocked(loadPeopleById).mockResolvedValue(new Map());
});

describe("admin.games loader", () => {
  it("sends anyone signed out to log in", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const res = (await load()) as Response;
    expect(res.status).toBe(302);
    expect(loadTunnelRunAggregates).not.toHaveBeenCalled();
  });

  it("sends members who aren't Core home without reading runs", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = (await load()) as Response;
    expect(res.headers.get("Location")).toBe("/");
    expect(loadTunnelRunAggregates).not.toHaveBeenCalled();
  });

  it("summarizes the runs in the window and names the players", async () => {
    const today = new Date().toISOString().slice(0, 10);
    vi.mocked(loadTunnelRunAggregates).mockResolvedValue(
      aggregates({
        totals: { runs: 2, quits: 1, bestScore: 400, medianScore: 250, medianDurationMs: 6000 },
        endings: [
          { endedBy: "fall", obstacle: "gap", count: 1 },
          { endedBy: "quit", obstacle: null, count: 1 },
        ],
        players: [{ userId: "ada", runs: 2, best: 400, medianScore: 250, lastPlayed: new Date() }],
      }),
    );
    vi.mocked(loadTunnelRunsPerDay).mockResolvedValue(new Map([[today, 2]]));
    vi.mocked(loadPeopleById).mockResolvedValue(new Map([["ada", { name: "Ada Lovelace", photoUrl: null }]]) as never);

    const data = (await load()) as Exclude<Awaited<ReturnType<typeof loader>>, Response>;
    expect(data.summary.runs).toBe(2);
    expect(data.summary.quits).toBe(1);
    expect(data.summary.playerRows).toEqual([expect.objectContaining({ userId: "ada", name: "Ada Lovelace", runs: 2, best: 400 })]);
    expect(data.series.reduce((a, b) => a + b, 0)).toBe(2);
    expect(loadPeopleById).toHaveBeenCalledWith(prisma, ["ada"]);
    const span = vi.mocked(loadTunnelRunAggregates).mock.calls[0][0];
    expect(span).toEqual({ since: expect.any(Date), until: expect.any(Date) });
    expect(vi.mocked(loadTunnelRunsPerDay).mock.calls[0][0]).toEqual(span);
  });

  it("calls a player with no profile a DALI member", async () => {
    vi.mocked(loadTunnelRunAggregates).mockResolvedValue(
      aggregates({ players: [{ userId: "gone", runs: 1, best: 5, medianScore: 5, lastPlayed: new Date() }] }),
    );
    const data = (await load()) as Exclude<Awaited<ReturnType<typeof loader>>, Response>;
    expect(data.summary.playerRows[0]).toMatchObject({ name: "A DALI member", photoUrl: null });
  });

  it("starts an all-time window at the first logged run", async () => {
    vi.mocked(prisma.tunnelRun.aggregate).mockResolvedValue({ _min: { createdAt: new Date("2026-11-16T12:00:00Z") } } as never);
    const data = (await load("http://os.test/admin/insights/games?range=all")) as Exclude<
      Awaited<ReturnType<typeof loader>>,
      Response
    >;
    expect(prisma.tunnelRun.aggregate).toHaveBeenCalled();
    expect(data.rangeKey).toBe("all");
  });
});
