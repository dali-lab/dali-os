import { prisma } from "~/lib/db.server";
import { scoreBoard } from "~/lib/game-scores.server";

// The leaderboard for the tunnel run on the week 10 (Technigala) home landing
// scene. See the TunnelScore model for what the score is and isn't worth.

/** A run scores about 40 a second at full speed, so this is hours of play. */
export const MAX_SCORE = 999_999;

export const { readLeaderboard, recordScore } = scoreBoard(prisma.tunnelScore, []);
