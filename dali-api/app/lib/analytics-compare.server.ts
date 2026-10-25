import type { PrismaClient } from "~/generated/prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pageviews for the given paths in the window of equal length that ends where
 * the current one starts: [since - days, since).
 */
export async function priorViewsByPath(
  db: Pick<PrismaClient, "$queryRaw">,
  paths: string[],
  since: Date,
  days: number,
): Promise<Map<string, number>> {
  if (paths.length === 0) return new Map();
  const priorSince = new Date(since.getTime() - days * DAY_MS);
  const rows = await db.$queryRaw<{ path: string; views: number }[]>`
    SELECT "path", COUNT(*)::int AS views
    FROM "PageView"
    WHERE "path" = ANY(${paths}::text[])
      AND "createdAt" >= ${priorSince} AND "createdAt" < ${since}
    GROUP BY "path"
  `;
  return new Map(rows.map((r) => [r.path, r.views]));
}

/** Whole-percent change from `prior` to `current`; null when there is no prior baseline. */
export function percentChange(current: number, prior: number): number | null {
  if (prior <= 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}
