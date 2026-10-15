import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";

// Reads and writes for the leaderboard on the week 5 ("Build") home landing
// scene. See the TetrisScore model for why a row is a personal best rather than
// a game log, and for what the score is and isn't worth.

/** How many places the board shows. */
export const LEADERBOARD_SIZE = 10;

/**
 * The widest score the server will record. Not a real ceiling on play — it is
 * well past anything reachable in a sitting — but the score arrives from the
 * browser, so something has to stop a typo or a console from parking an
 * unbeatable number at the top of a board nobody can then take back.
 */
export const MAX_SCORE = 9_999_999;

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  name: string;
  score: number;
  lines: number;
  level: number;
  achievedAt: string;
};

export type Leaderboard = {
  entries: LeaderboardEntry[];
  /** The caller's own best, even when it didn't place. Null until they finish a game. */
  you: LeaderboardEntry | null;
};

/** Highest first; the earlier run wins a tie, so holding a place takes beating it. */
const BEST_FIRST = [{ score: "desc" as const }, { achievedAt: "asc" as const }];

const SELECT = {
  userId: true,
  score: true,
  lines: true,
  level: true,
  achievedAt: true,
  user: { select: { firstName: true, lastName: true } },
};

type Row = {
  userId: string;
  score: number;
  lines: number;
  level: number;
  achievedAt: Date;
  user: { firstName: string | null; lastName: string | null };
};

function toEntry(row: Row, rank: number): LeaderboardEntry {
  return {
    rank,
    userId: row.userId,
    // Names are read through the relation rather than copied onto the score, so
    // the board follows a rename instead of preserving whatever someone was
    // called the night they played.
    name: fullName(row.user) || "A DALI member",
    score: row.score,
    lines: row.lines,
    level: row.level,
    achievedAt: row.achievedAt.toISOString(),
  };
}

export async function readLeaderboard(userId: string): Promise<Leaderboard> {
  const rows = await prisma.tetrisScore.findMany({
    orderBy: BEST_FIRST,
    take: LEADERBOARD_SIZE,
    select: SELECT,
  });
  const entries = rows.map((row, i) => toEntry(row as Row, i + 1));

  const placed = entries.find((entry) => entry.userId === userId);
  if (placed) return { entries, you: placed };

  // Off the board: fetch the caller's own row and count how many beat it, so
  // they still see where they stand instead of just that they didn't place.
  const mine = await prisma.tetrisScore.findUnique({ where: { userId }, select: SELECT });
  if (!mine) return { entries, you: null };
  const ahead = await prisma.tetrisScore.count({
    where: {
      OR: [
        { score: { gt: mine.score } },
        { score: mine.score, achievedAt: { lt: mine.achievedAt } },
      ],
    },
  });
  return { entries, you: toEntry(mine as Row, ahead + 1) };
}

/**
 * Record a finished game, keeping it only if it beats what the player already
 * had. Returns the board as it stands afterwards, plus whether this run was a
 * new personal best — the game says so on the score, and it would otherwise
 * have to work that out by diffing two boards.
 */
export async function recordScore(
  userId: string,
  run: { score: number; lines: number; level: number },
): Promise<Leaderboard & { personalBest: boolean }> {
  const existing = await prisma.tetrisScore.findUnique({
    where: { userId },
    select: { score: true },
  });
  const personalBest = !existing || run.score > existing.score;

  if (personalBest) {
    await prisma.tetrisScore.upsert({
      where: { userId },
      // achievedAt is set explicitly on update: @default only fires on create,
      // and a beaten best is a new run, not an edit of the old one.
      update: { ...run, achievedAt: new Date() },
      create: { userId, ...run },
    });
  }

  return { ...(await readLeaderboard(userId)), personalBest };
}
