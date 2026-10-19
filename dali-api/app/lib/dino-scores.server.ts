import { prisma } from "~/lib/db";
import { scoreBoard } from "~/lib/game-scores.server";

// The leaderboard for the runner game on every error screen. See the DinoScore
// model for what the score is and isn't worth.

/** Past any real run (the score is tenths of a second survived, so this is
 *  over a day) but stops a console from parking an unbeatable number. */
export const MAX_SCORE = 999_999;

export const { readLeaderboard, recordScore } = scoreBoard(prisma.dinoScore, []);
