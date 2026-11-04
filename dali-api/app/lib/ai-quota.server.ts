import { prisma } from "~/lib/db.server";

export const AI_DAILY_MAX = 200;

export function secondsToUtcMidnight(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export type AiQuotaResult = { ok: true; day: string } | { ok: false; error: string; retryAfterSeconds: number };

// Increment-then-check keeps the cap exact under concurrent requests.
export async function claimAiQuota(userId: string): Promise<AiQuotaResult> {
  const day = new Date().toISOString().slice(0, 10);
  const usage = await prisma.aiUsage.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (usage.count > AI_DAILY_MAX) {
    return {
      ok: false,
      error: `You've reached today's AI limit (${AI_DAILY_MAX} requests). It resets at midnight UTC.`,
      retryAfterSeconds: secondsToUtcMidnight(),
    };
  }
  return { ok: true, day };
}

export function aiQuotaResponse(result: Extract<AiQuotaResult, { ok: false }>): Response {
  return Response.json(
    { error: result.error },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
