// Summaries of the tunnel run log (TunnelRun) for Admin > Insights > Games.

export type Count = { key: string; label: string; count: number };

const ENDINGS: { key: string; label: string }[] = [
  { key: "gap", label: "Fell through a gap" },
  { key: "strip", label: "Fell off a narrow strip" },
  { key: "holes", label: "Fell into a hole" },
  { key: "spiral", label: "Caught by the turning band" },
  { key: "quit", label: "Left the run" },
  { key: "unknown", label: "Fell, obstacle not recorded" },
];

export const SCORE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "Under 100", min: 0, max: 99 },
  { label: "100 to 249", min: 100, max: 249 },
  { label: "250 to 499", min: 250, max: 499 },
  { label: "500 to 999", min: 500, max: 999 },
  { label: "1,000 to 1,999", min: 1000, max: 1999 },
  { label: "2,000 and up", min: 2000, max: Infinity },
];

const RUNS_PER_PLAYER: { label: string; min: number; max: number }[] = [
  { label: "1 run", min: 1, max: 1 },
  { label: "2 to 4 runs", min: 2, max: 4 },
  { label: "5 to 9 runs", min: 5, max: 9 },
  { label: "10 or more", min: 10, max: Infinity },
];

export type TunnelRunAggregates = {
  totals: {
    runs: number;
    quits: number;
    bestScore: number | null;
    medianScore: number | null;
    medianDurationMs: number | null;
  };
  endings: { endedBy: string; obstacle: string | null; count: number }[];
  scoreBucketCounts: number[];
  players: { userId: string; runs: number; best: number; medianScore: number; lastPlayed: Date }[];
  learning: { firstRunMedian: number | null; laterRunMedian: number | null; laterRuns: number };
};

function endingKey(endedBy: string, obstacle: string | null) {
  if (endedBy === "quit") return "quit";
  return obstacle ?? "unknown";
}

export function summarizeTunnelRuns(agg: TunnelRunAggregates) {
  const endingCounts = new Map<string, number>();
  for (const e of agg.endings) {
    const key = endingKey(e.endedBy, e.obstacle);
    endingCounts.set(key, (endingCounts.get(key) ?? 0) + e.count);
  }

  const players = agg.players.map((p) => ({
    userId: p.userId,
    runs: p.runs,
    best: p.best,
    medianScore: p.medianScore,
    lastPlayed: p.lastPlayed.toISOString(),
  }));

  return {
    runs: agg.totals.runs,
    players: players.length,
    quits: endingCounts.get("quit") ?? 0,
    bestScore: agg.totals.bestScore,
    medianScore: agg.totals.medianScore,
    medianDurationMs: agg.totals.medianDurationMs,
    endings: ENDINGS.map(({ key, label }): Count => ({ key, label, count: endingCounts.get(key) ?? 0 })).filter(
      (e) => e.count > 0,
    ),
    scoreBuckets: SCORE_BUCKETS.map(({ label }, i): Count => ({
      key: label,
      label,
      count: agg.scoreBucketCounts[i] ?? 0,
    })),
    runsPerPlayer: RUNS_PER_PLAYER.map(({ label, min, max }): Count => ({
      key: label,
      label,
      count: players.filter((p) => p.runs >= min && p.runs <= max).length,
    })),
    learning: agg.learning,
    playerRows: players,
  };
}

export type TunnelRunSummary = ReturnType<typeof summarizeTunnelRuns>;
