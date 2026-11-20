import { describe, expect, it } from "vitest";
import { SCORE_BUCKETS, summarizeTunnelRuns, type TunnelRunAggregates } from "../tunnel-runs";

const agg = (o: Partial<TunnelRunAggregates> = {}): TunnelRunAggregates => ({
  totals: { runs: 0, quits: 0, bestScore: null, medianScore: null, medianDurationMs: null },
  endings: [],
  scoreBucketCounts: SCORE_BUCKETS.map(() => 0),
  players: [],
  learning: { firstRunMedian: null, laterRunMedian: null, laterRuns: 0 },
  ...o,
});

const player = (userId: string, runs: number, best = 100) => ({
  userId,
  runs,
  best,
  medianScore: 50,
  lastPlayed: new Date("2026-11-16T18:00:00Z"),
});

describe("SCORE_BUCKETS", () => {
  it("run on without gaps, which the SQL bucketing relies on", () => {
    SCORE_BUCKETS.slice(1).forEach((b, i) => expect(b.min).toBe(SCORE_BUCKETS[i].max + 1));
    expect(SCORE_BUCKETS[0].min).toBe(0);
  });
});

describe("summarizeTunnelRuns", () => {
  it("is empty for no runs", () => {
    const s = summarizeTunnelRuns(agg());
    expect(s).toMatchObject({ runs: 0, players: 0, bestScore: null, medianScore: null, endings: [], playerRows: [] });
    expect(s.scoreBuckets.every((b) => b.count === 0)).toBe(true);
  });

  it("passes the totals through and counts players and quits", () => {
    const s = summarizeTunnelRuns(
      agg({
        totals: { runs: 3, quits: 1, bestScore: 300, medianScore: 100, medianDurationMs: 4000 },
        endings: [
          { endedBy: "fall", obstacle: "gap", count: 2 },
          { endedBy: "quit", obstacle: null, count: 1 },
        ],
        players: [player("ada", 2), player("grace", 1)],
      }),
    );
    expect(s).toMatchObject({ runs: 3, players: 2, quits: 1, bestScore: 300, medianScore: 100, medianDurationMs: 4000 });
  });

  it("says how runs end, merging by ending and leaving out endings nobody hit", () => {
    const s = summarizeTunnelRuns(
      agg({
        endings: [
          { endedBy: "fall", obstacle: "strip", count: 2 },
          { endedBy: "fall", obstacle: null, count: 1 },
          { endedBy: "quit", obstacle: "gap", count: 1 },
          { endedBy: "quit", obstacle: null, count: 3 },
        ],
      }),
    );
    expect(s.endings.map((e) => [e.key, e.count])).toEqual([
      ["strip", 2],
      ["quit", 4],
      ["unknown", 1],
    ]);
  });

  it("labels score buckets in order and fills missing ones with zero", () => {
    const s = summarizeTunnelRuns(agg({ scoreBucketCounts: [1, 1, 0, 10] }));
    expect(s.scoreBuckets.map((b) => b.count)).toEqual([1, 1, 0, 10, 0, 0]);
    expect(s.scoreBuckets.map((b) => b.label)).toEqual(SCORE_BUCKETS.map((b) => b.label));
  });

  it("groups players by how many runs they made", () => {
    const s = summarizeTunnelRuns(
      agg({ players: [player("a", 1), player("b", 3), player("c", 4), player("d", 10), player("e", 25)] }),
    );
    expect(s.runsPerPlayer.map((b) => b.count)).toEqual([1, 2, 0, 2]);
  });

  it("keeps the player order it was given and formats the last played time", () => {
    const s = summarizeTunnelRuns(agg({ players: [player("grace", 2, 500), player("ada", 1, 10)] }));
    expect(s.playerRows.map((p) => [p.userId, p.runs, p.best])).toEqual([
      ["grace", 2, 500],
      ["ada", 1, 10],
    ]);
    expect(s.playerRows[0].lastPlayed).toBe("2026-11-16T18:00:00.000Z");
  });

  it("passes the learning comparison through", () => {
    const learning = { firstRunMedian: 75, laterRunMedian: 1000, laterRuns: 2 };
    expect(summarizeTunnelRuns(agg({ learning })).learning).toEqual(learning);
  });
});
