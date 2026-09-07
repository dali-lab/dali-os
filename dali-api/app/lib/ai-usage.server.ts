// Token accounting for the AI routes (/api/ai/doc, /api/ai/project-tldr),
// kept separate from ai.server so provider resolution stays db-free (and its
// unit test needs no Prisma client). Writes to the caller's AiUsage row created
// by that request's daily-quota upsert.

import { prisma } from "~/lib/db";

/**
 * Best-effort token accounting on the caller's AiUsage row. Never throws — a
 * failed write must not break an otherwise successful AI response. Exported for
 * unit tests.
 */
export async function recordTokenUsage(
  userId: string,
  day: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  if (inputTokens <= 0 && outputTokens <= 0) return;
  try {
    await prisma.aiUsage.update({
      where: { userId_day: { userId, day } },
      data: {
        inputTokens: { increment: inputTokens },
        outputTokens: { increment: outputTokens },
      },
    });
  } catch {
    // Telemetry only.
  }
}
