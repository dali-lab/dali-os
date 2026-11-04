import { prisma } from "~/lib/db.server";

export const AI_DAILY_MAX = 200;

export function secondsToUtcMidnight(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export type AiQuotaResult =
  | { ok: true; day: string; used: number }
  | { ok: false; error: string; retryAfterSeconds: number };

export const ASK_DAILY_MAX = 50;

// Increment-then-check keeps the cap exact under concurrent requests.
async function claimQuota(
  userId: string,
  field: "count" | "askCount",
  max: number,
  error: string,
): Promise<AiQuotaResult> {
  const day = new Date().toISOString().slice(0, 10);
  const usage = await prisma.aiUsage.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, [field]: 1 },
    update: { [field]: { increment: 1 } },
  });
  if (usage[field] > max) {
    return { ok: false, error, retryAfterSeconds: secondsToUtcMidnight() };
  }
  return { ok: true, day, used: usage[field] };
}

export function claimAiQuota(userId: string): Promise<AiQuotaResult> {
  return claimQuota(
    userId,
    "count",
    AI_DAILY_MAX,
    `You've reached today's AI limit (${AI_DAILY_MAX} requests). It resets at midnight UTC.`,
  );
}

export function claimAskQuota(userId: string): Promise<AiQuotaResult> {
  return claimQuota(
    userId,
    "askCount",
    ASK_DAILY_MAX,
    "You've used today's questions. They reset at midnight UTC.",
  );
}

export async function releaseAskQuota(userId: string, day: string): Promise<void> {
  try {
    await prisma.aiUsage.updateMany({
      where: { userId, day, askCount: { gt: 0 } },
      data: { askCount: { decrement: 1 } },
    });
  } catch {
    // Best effort: a failed refund only costs the member one question.
  }
}

export function aiQuotaResponse(result: Extract<AiQuotaResult, { ok: false }>): Response {
  return Response.json(
    { error: result.error },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
