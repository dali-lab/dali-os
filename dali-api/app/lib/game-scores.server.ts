import { fullName } from "~/lib/display";

// One personal-best-per-player leaderboard, shared by the easter-egg games
// (TetrisScore, DinoScore). Each game keeps its own table; the tables share a
// shape: userId as the key, score, achievedAt, and any game-specific columns.

/** How many places the board shows. */
export const LEADERBOARD_SIZE = 10;

export type LeaderboardEntry<Extra = object> = {
  rank: number;
  userId: string;
  name: string;
  score: number;
  achievedAt: string;
} & Extra;

export type Leaderboard<Extra = object> = {
  entries: LeaderboardEntry<Extra>[];
  /** The caller's own best, even when it didn't place. Null until they finish a game. */
  you: LeaderboardEntry<Extra> | null;
};

type Row = {
  userId: string;
  score: number;
  achievedAt: Date;
  user: { firstName: string | null; lastName: string | null };
  [field: string]: unknown;
};

// `any` because each game passes its own Prisma delegate, and the delegates'
// argument types share no common supertype.
export type ScoreTable = {
  findMany(args: any): Promise<any[]>;
  findUnique(args: any): Promise<any>;
  upsert(args: any): Promise<unknown>;
  count(args: any): Promise<number>;
};

/** Highest first; the earlier run wins a tie, so holding a place takes beating it. */
const BEST_FIRST = [{ score: "desc" as const }, { achievedAt: "asc" as const }];

export function scoreBoard<Extra extends Record<string, number>>(
  table: ScoreTable,
  extraFields: readonly (keyof Extra & string)[],
) {
  const select = {
    userId: true,
    score: true,
    achievedAt: true,
    user: { select: { firstName: true, lastName: true } },
    ...Object.fromEntries(extraFields.map((f) => [f, true])),
  };

  function toEntry(row: Row, rank: number): LeaderboardEntry<Extra> {
    const extra = Object.fromEntries(extraFields.map((f) => [f, row[f]])) as Extra;
    return {
      rank,
      userId: row.userId,
      // Names are read through the relation rather than copied onto the score, so
      // the board follows a rename instead of preserving whatever someone was
      // called the night they played.
      name: fullName(row.user) || "A DALI member",
      score: row.score,
      achievedAt: row.achievedAt.toISOString(),
      ...extra,
    };
  }

  async function readLeaderboard(userId: string): Promise<Leaderboard<Extra>> {
    const rows: Row[] = await table.findMany({ orderBy: BEST_FIRST, take: LEADERBOARD_SIZE, select });
    const entries = rows.map((row, i) => toEntry(row, i + 1));

    const placed = entries.find((entry) => entry.userId === userId);
    if (placed) return { entries, you: placed };

    const mine: Row | null = await table.findUnique({ where: { userId }, select });
    if (!mine) return { entries, you: null };
    const ahead = await table.count({
      where: {
        OR: [
          { score: { gt: mine.score } },
          { score: mine.score, achievedAt: { lt: mine.achievedAt } },
        ],
      },
    });
    return { entries, you: toEntry(mine, ahead + 1) };
  }

  /**
   * Record a finished game, keeping it only if it beats what the player already
   * had. Returns the board as it stands afterwards, plus whether this run was a
   * new personal best.
   */
  async function recordScore(
    userId: string,
    run: { score: number } & Extra,
  ): Promise<Leaderboard<Extra> & { personalBest: boolean }> {
    const existing: { score: number } | null = await table.findUnique({
      where: { userId },
      select: { score: true },
    });
    const personalBest = !existing || run.score > existing.score;

    if (personalBest) {
      await table.upsert({
        where: { userId },
        // achievedAt is set explicitly on update: @default only fires on create,
        // and a beaten best is a new run, not an edit of the old one.
        update: { ...run, achievedAt: new Date() },
        create: { userId, ...run },
      });
    }

    return { ...(await readLeaderboard(userId)), personalBest };
  }

  return { readLeaderboard, recordScore };
}
