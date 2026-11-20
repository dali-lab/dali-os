import { prisma } from "~/lib/db.server";
import { SCORE_BUCKETS, type TunnelRunAggregates } from "./tunnel-runs";

const BUCKET_FLOORS = SCORE_BUCKETS.slice(1).map((b) => b.min);

type Window = { since: Date; until: Date };

type TotalsRow = {
  runs: number;
  quits: number;
  bestScore: number | null;
  medianScore: number | null;
  medianDurationMs: number | null;
};
type BucketRow = { bucket: number; count: number };
type PlayerRow = { userId: string; runs: number; best: number; medianScore: number; lastPlayed: Date };
type LearningRow = { firstRunMedian: number | null; laterRunMedian: number | null; laterRuns: number };
type DayRow = { day: string; count: number };

export async function loadTunnelRunAggregates({ since, until }: Window): Promise<TunnelRunAggregates> {
  const where = { createdAt: { gte: since, lte: until } };
  const [totals, endings, buckets, players, learning] = await Promise.all([
    prisma.$queryRaw<TotalsRow[]>`
      SELECT count(*)::int AS runs,
        (count(*) FILTER (WHERE "endedBy" = 'quit'))::int AS quits,
        max(score)::int AS "bestScore",
        round((percentile_cont(0.5) WITHIN GROUP (ORDER BY score))::numeric)::int AS "medianScore",
        round((percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs"))::numeric)::int AS "medianDurationMs"
      FROM "TunnelRun"
      WHERE "createdAt" >= ${since} AND "createdAt" <= ${until}`,
    prisma.tunnelRun.groupBy({ by: ["endedBy", "obstacle"], where, _count: { _all: true } }),
    prisma.$queryRaw<BucketRow[]>`
      SELECT width_bucket(score, ${BUCKET_FLOORS}::int[])::int AS bucket, count(*)::int AS count
      FROM "TunnelRun"
      WHERE "createdAt" >= ${since} AND "createdAt" <= ${until}
      GROUP BY 1`,
    prisma.$queryRaw<PlayerRow[]>`
      SELECT "userId", count(*)::int AS runs, max(score)::int AS best,
        round((percentile_cont(0.5) WITHIN GROUP (ORDER BY score))::numeric)::int AS "medianScore",
        max("createdAt") AS "lastPlayed"
      FROM "TunnelRun"
      WHERE "createdAt" >= ${since} AND "createdAt" <= ${until}
      GROUP BY "userId"
      ORDER BY runs DESC, best DESC, min("createdAt")`,
    prisma.$queryRaw<LearningRow[]>`
      WITH ranked AS (
        SELECT score, row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt") AS n
        FROM "TunnelRun"
        WHERE "createdAt" >= ${since} AND "createdAt" <= ${until}
      )
      SELECT
        round((percentile_cont(0.5) WITHIN GROUP (ORDER BY score) FILTER (WHERE n = 1))::numeric)::int AS "firstRunMedian",
        round((percentile_cont(0.5) WITHIN GROUP (ORDER BY score) FILTER (WHERE n >= 5))::numeric)::int AS "laterRunMedian",
        (count(*) FILTER (WHERE n >= 5))::int AS "laterRuns"
      FROM ranked`,
  ]);

  const scoreBucketCounts = SCORE_BUCKETS.map(() => 0);
  for (const b of buckets) scoreBucketCounts[b.bucket] = b.count;

  return {
    totals: totals[0],
    endings: endings.map((e) => ({ endedBy: e.endedBy, obstacle: e.obstacle, count: e._count._all })),
    scoreBucketCounts,
    players,
    learning: learning[0],
  };
}

export async function loadTunnelRunsPerDay({ since, until }: Window): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<DayRow[]>`
    SELECT to_char("createdAt", 'YYYY-MM-DD') AS day, count(*)::int AS count
    FROM "TunnelRun"
    WHERE "createdAt" >= ${since} AND "createdAt" <= ${until}
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.day, r.count]));
}
