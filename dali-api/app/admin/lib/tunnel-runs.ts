// Summaries of the tunnel run log (TunnelRun) for Admin > Insights > Games.

export type TunnelRunRow = {
  userId: string;
  score: number;
  durationMs: number | null;
  endedBy: string;
  obstacle: string | null;
  createdAt: Date;
};

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

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function endingKey(run: TunnelRunRow) {
  if (run.endedBy === "quit") return "quit";
  return run.obstacle ?? "unknown";
}

export function summarizeTunnelRuns(rows: TunnelRunRow[]) {
  const byPlayer = new Map<string, TunnelRunRow[]>();
  for (const row of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const list = byPlayer.get(row.userId) ?? [];
    list.push(row);
    byPlayer.set(row.userId, list);
  }

  const endingCounts = new Map<string, number>();
  for (const row of rows) endingCounts.set(endingKey(row), (endingCounts.get(endingKey(row)) ?? 0) + 1);

  const scores = rows.map((r) => r.score);
  const durations = rows.flatMap((r) => (r.durationMs === null ? [] : [r.durationMs]));

  // Whether people get better: everyone's first run in the window against their fifth run on.
  const firstRuns: number[] = [];
  const laterRuns: number[] = [];
  for (const runs of byPlayer.values()) {
    firstRuns.push(runs[0].score);
    for (const run of runs.slice(4)) laterRuns.push(run.score);
  }

  const players = [...byPlayer.entries()]
    .map(([userId, runs]) => ({
      userId,
      runs: runs.length,
      best: Math.max(...runs.map((r) => r.score)),
      medianScore: median(runs.map((r) => r.score)) ?? 0,
      lastPlayed: runs[runs.length - 1].createdAt.toISOString(),
    }))
    .sort((a, b) => b.runs - a.runs || b.best - a.best);

  return {
    runs: rows.length,
    players: byPlayer.size,
    quits: endingCounts.get("quit") ?? 0,
    bestScore: scores.length ? Math.max(...scores) : null,
    medianScore: median(scores),
    medianDurationMs: median(durations),
    endings: ENDINGS.map(({ key, label }): Count => ({ key, label, count: endingCounts.get(key) ?? 0 })).filter(
      (e) => e.count > 0,
    ),
    scoreBuckets: SCORE_BUCKETS.map(({ label, min, max }): Count => ({
      key: label,
      label,
      count: scores.filter((s) => s >= min && s <= max).length,
    })),
    runsPerPlayer: RUNS_PER_PLAYER.map(({ label, min, max }): Count => ({
      key: label,
      label,
      count: players.filter((p) => p.runs >= min && p.runs <= max).length,
    })),
    learning: {
      firstRunMedian: median(firstRuns),
      laterRunMedian: median(laterRuns),
      laterRuns: laterRuns.length,
    },
    playerRows: players,
  };
}

export type TunnelRunSummary = ReturnType<typeof summarizeTunnelRuns>;
