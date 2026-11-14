import { describe, expect, it } from "vitest";
import { median, summarizeTunnelRuns, type TunnelRunRow } from "../tunnel-runs";

let clock = Date.UTC(2026, 10, 16, 18);
function run(userId: string, score: number, extra: Partial<TunnelRunRow> = {}): TunnelRunRow {
  clock += 60_000;
  return { userId, score, durationMs: score * 25, endedBy: "fall", obstacle: "gap", createdAt: new Date(clock), ...extra };
}

describe("median", () => {
  it("handles empty, odd and even lists", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
  });
});

describe("summarizeTunnelRuns", () => {
  it("is empty for no runs", () => {
    const s = summarizeTunnelRuns([]);
    expect(s.runs).toBe(0);
    expect(s.players).toBe(0);
    expect(s.bestScore).toBeNull();
    expect(s.medianScore).toBeNull();
    expect(s.endings).toEqual([]);
    expect(s.playerRows).toEqual([]);
  });

  it("counts runs, players, quits and the best", () => {
    const s = summarizeTunnelRuns([
      run("ada", 100),
      run("ada", 300),
      run("grace", 50, { endedBy: "quit", obstacle: null }),
    ]);
    expect(s.runs).toBe(3);
    expect(s.players).toBe(2);
    expect(s.quits).toBe(1);
    expect(s.bestScore).toBe(300);
    expect(s.medianScore).toBe(100);
  });

  it("says how runs end, leaving out endings nobody hit", () => {
    const s = summarizeTunnelRuns([
      run("ada", 10, { obstacle: "strip" }),
      run("ada", 20, { obstacle: "strip" }),
      run("ada", 30, { obstacle: null }),
      run("ada", 40, { endedBy: "quit", obstacle: null }),
    ]);
    expect(s.endings.map((e) => [e.key, e.count])).toEqual([
      ["strip", 2],
      ["quit", 1],
      ["unknown", 1],
    ]);
  });

  it("buckets scores and players", () => {
    const s = summarizeTunnelRuns([
      run("ada", 99),
      run("ada", 100),
      run("ada", 2500),
      ...Array.from({ length: 10 }, () => run("grace", 600)),
    ]);
    expect(s.scoreBuckets.map((b) => b.count)).toEqual([1, 1, 0, 10, 0, 1]);
    expect(s.runsPerPlayer.map((b) => b.count)).toEqual([0, 1, 0, 1]);
  });

  it("compares first runs with runs from the fifth on", () => {
    const s = summarizeTunnelRuns([
      ...[100, 200, 300, 400, 900, 1100].map((score) => run("ada", score)),
      run("grace", 50),
    ]);
    expect(s.learning.firstRunMedian).toBe(75);
    expect(s.learning.laterRunMedian).toBe(1000);
    expect(s.learning.laterRuns).toBe(2);
  });

  it("orders first runs by time, not by the order rows arrive in", () => {
    const later = run("ada", 900);
    const earlier = { ...run("ada", 100), createdAt: new Date(later.createdAt.getTime() - 3_600_000) };
    expect(summarizeTunnelRuns([later, earlier]).learning.firstRunMedian).toBe(100);
  });

  it("lists players by how much they play, then by their best", () => {
    const s = summarizeTunnelRuns([run("ada", 10), run("grace", 500), run("grace", 5), run("alan", 900)]);
    expect(s.playerRows.map((p) => [p.userId, p.runs, p.best])).toEqual([
      ["grace", 2, 500],
      ["alan", 1, 900],
      ["ada", 1, 10],
    ]);
  });

  it("ignores missing durations in the median run length", () => {
    const s = summarizeTunnelRuns([run("ada", 40, { durationMs: null }), run("ada", 40, { durationMs: 8000 })]);
    expect(s.medianDurationMs).toBe(8000);
  });
});
