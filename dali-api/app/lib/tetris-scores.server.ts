import { prisma } from "~/lib/db.server";
import { scoreBoard } from "~/lib/game-scores.server";

// The leaderboard for the tetris game on the week 5 ("Build") home landing
// scene. See the TetrisScore model for what the score is and isn't worth.

/**
 * The widest score the server will record. Not a real ceiling on play — it is
 * well past anything reachable in a sitting — but the score arrives from the
 * browser, so something has to stop a typo or a console from parking an
 * unbeatable number at the top of a board nobody can then take back.
 */
export const MAX_SCORE = 9_999_999;

export const { readLeaderboard, recordScore } = scoreBoard<{ lines: number; level: number }>(
  prisma.tetrisScore,
  ["lines", "level"],
);
