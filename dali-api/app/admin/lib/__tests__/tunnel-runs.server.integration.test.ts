import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { makeUser } from "~/lib/__tests__/integration-fixtures.calendar";
import { loadTunnelRunAggregates, loadTunnelRunsPerDay } from "../tunnel-runs.server";
import { summarizeTunnelRuns } from "../tunnel-runs";

const day = (d: number, h = 12) => new Date(Date.UTC(2026, 10, d, h));
const window = { since: day(1, 0), until: day(30, 0) };

type Run = { userId: string; score: number; at: Date; durationMs?: number | null; endedBy?: string; obstacle?: string | null };
const log = (runs: Run[]) =>
  prisma.tunnelRun.createMany({
    data: runs.map((r) => ({
      userId: r.userId,
      score: r.score,
      createdAt: r.at,
      durationMs: r.durationMs === undefined ? r.score * 25 : r.durationMs,
      endedBy: r.endedBy ?? "fall",
      obstacle: r.obstacle === undefined ? "gap" : r.obstacle,
    })),
  });

describe("tunnel run aggregates against Postgres", () => {
  it("is empty with no runs", async () => {
    const s = summarizeTunnelRuns(await loadTunnelRunAggregates(window));
    expect(s).toMatchObject({ runs: 0, players: 0, quits: 0, bestScore: null, medianScore: null, medianDurationMs: null });
    expect(s.learning).toEqual({ firstRunMedian: null, laterRunMedian: null, laterRuns: 0 });
    expect(await loadTunnelRunsPerDay(window)).toEqual(new Map());
  });

  it("counts runs, players, quits, best and medians, including an even count rounded up", async () => {
    const ada = await makeUser();
    const grace = await makeUser("Grace", "Hopper");
    await log([
      { userId: ada.id, score: 100, at: day(2) },
      { userId: ada.id, score: 300, at: day(3) },
      { userId: grace.id, score: 50, at: day(3), endedBy: "quit", obstacle: null, durationMs: null },
      { userId: grace.id, score: 400, at: day(4), durationMs: 8000 },
    ]);
    const s = summarizeTunnelRuns(await loadTunnelRunAggregates(window));
    expect(s).toMatchObject({ runs: 4, players: 2, quits: 1, bestScore: 400, medianScore: 200 });
    expect(s.medianDurationMs).toBe(7500);
    expect(s.endings.map((e) => [e.key, e.count])).toEqual([["gap", 3], ["quit", 1]]);
  });

  it("only reads runs inside the window", async () => {
    const ada = await makeUser();
    await log([
      { userId: ada.id, score: 10, at: day(2) },
      { userId: ada.id, score: 999, at: new Date(Date.UTC(2026, 9, 1)) },
      { userId: ada.id, score: 888, at: new Date(Date.UTC(2026, 11, 20)) },
    ]);
    const s = summarizeTunnelRuns(await loadTunnelRunAggregates(window));
    expect(s).toMatchObject({ runs: 1, bestScore: 10 });
  });

  it("puts scores into buckets on their boundaries", async () => {
    const ada = await makeUser();
    await log([99, 100, 249, 250, 999, 1000, 1999, 2000, 2500].map((score, i) => ({ userId: ada.id, score, at: day(2, i) })));
    const s = summarizeTunnelRuns(await loadTunnelRunAggregates(window));
    expect(s.scoreBuckets.map((b) => b.count)).toEqual([1, 2, 1, 1, 2, 2]);
  });

  it("lists players by runs then best, with their own median and last run", async () => {
    const ada = await makeUser();
    const grace = await makeUser("Grace", "Hopper");
    const alan = await makeUser("Alan", "Turing");
    await log([
      { userId: ada.id, score: 10, at: day(2) },
      { userId: grace.id, score: 500, at: day(3) },
      { userId: grace.id, score: 5, at: day(5) },
      { userId: alan.id, score: 900, at: day(4) },
    ]);
    const s = summarizeTunnelRuns(await loadTunnelRunAggregates(window));
    expect(s.playerRows.map((p) => [p.userId, p.runs, p.best])).toEqual([
      [grace.id, 2, 500],
      [alan.id, 1, 900],
      [ada.id, 1, 10],
    ]);
    expect(s.playerRows[0]).toMatchObject({ medianScore: 253, lastPlayed: day(5).toISOString() });
    expect(s.runsPerPlayer.map((b) => b.count)).toEqual([2, 1, 0, 0]);
  });

  it("compares first runs with runs from the fifth on, ordering by time not insertion", async () => {
    const ada = await makeUser();
    const grace = await makeUser("Grace", "Hopper");
    await log([
      { userId: ada.id, score: 1100, at: day(9) },
      { userId: ada.id, score: 900, at: day(8) },
      ...[100, 200, 300, 400].map((score, i) => ({ userId: ada.id, score, at: day(2 + i) })),
      { userId: grace.id, score: 50, at: day(2) },
    ]);
    const s = summarizeTunnelRuns(await loadTunnelRunAggregates(window));
    expect(s.learning).toEqual({ firstRunMedian: 75, laterRunMedian: 1000, laterRuns: 2 });
  });

  it("counts runs per UTC day", async () => {
    const ada = await makeUser();
    await log([
      { userId: ada.id, score: 1, at: day(2, 1) },
      { userId: ada.id, score: 1, at: day(2, 23) },
      { userId: ada.id, score: 1, at: day(5) },
    ]);
    expect(await loadTunnelRunsPerDay(window)).toEqual(new Map([["2026-11-02", 2], ["2026-11-05", 1]]));
  });
});
