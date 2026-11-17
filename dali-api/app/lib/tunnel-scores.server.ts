import { prisma } from "~/lib/db.server";
import { scoreBoard } from "~/lib/game-scores.server";

// The leaderboard for the tunnel run on the week 10 (Technigala) home landing
// scene, and the log of every run behind it. See the TunnelScore and TunnelRun
// models for what the numbers are and aren't worth.

/** A run scores about 40 a second at full speed, so this is hours of play. */
export const MAX_SCORE = 999_999;
/** A day. Longer is a tab left paused, not a run. */
export const MAX_DURATION_MS = 86_400_000;
export const OBSTACLES = ["gap", "strip", "holes", "spiral"] as const;
export const RUN_ENDINGS = ["fall", "quit"] as const;

export type TunnelRunReport = {
  score: number;
  durationMs: number | null;
  endedBy: (typeof RUN_ENDINGS)[number];
  obstacle: (typeof OBSTACLES)[number] | null;
};

export const { readLeaderboard, recordScore } = scoreBoard(prisma.tunnelScore, []);

export function logRun(userId: string, run: TunnelRunReport) {
  return prisma.tunnelRun.create({ data: { userId, ...run } });
}
