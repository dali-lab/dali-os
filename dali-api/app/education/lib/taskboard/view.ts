import type { BoardPeriod, CurrentPosition, WeekRef } from "./weeks";

export function resolveViewed(
  periods: BoardPeriod[],
  current: CurrentPosition | null,
  periodParam: string | null,
  weekParam: string | null,
): WeekRef | null {
  const fallback = current ? { periodId: current.periodId, week: current.week } : null;
  if (!periodParam || !weekParam) return fallback;
  const period = periods.find((p) => p.id === periodParam);
  const week = /^\d+$/.test(weekParam) ? Number(weekParam) : Number.NaN;
  if (!period || !Number.isInteger(week) || week < 1 || week > period.weekCount) return fallback;
  return { periodId: period.id, week };
}
