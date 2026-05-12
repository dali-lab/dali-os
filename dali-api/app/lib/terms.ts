import { prisma } from "~/lib/db";

// Returns the active Term row that best represents "now" — the term whose
// [startDate, endDate] window contains today, falling back to the most
// recently started term if there's no current match. Throws if no terms
// exist (callers should ensure a Term seed exists in any environment that
// makes term-bound assignments).
export async function getCurrentTermId(now: Date = new Date()): Promise<string> {
  const current = await prisma.term.findFirst({
    where: { startDate: { lte: now }, endDate: { gte: now } },
    select: { id: true },
    orderBy: { sortKey: "desc" },
  });
  if (current) return current.id;

  const fallback = await prisma.term.findFirst({
    select: { id: true },
    orderBy: { sortKey: "desc" },
  });
  if (!fallback) {
    throw new Error("No Term rows exist; cannot resolve current term");
  }
  return fallback.id;
}
