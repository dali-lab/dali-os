export type PeriodKind = "Term" | "Interim" | "Custom";

export type BoardPeriod = {
  id: string;
  name: string;
  shortName: string;
  kind: PeriodKind;
  startDate: string;
  weekCount: number;
};

export type WeekRef = { periodId: string; week: number };

export const MIN_WEEKS = 4;
export const MAX_WEEKS = 14;
export const MIN_FLEX_WEEKS = 1;
const DAY_MS = 86_400_000;

export function clampWeekCount(n: number): number {
  if (!Number.isFinite(n)) return MIN_WEEKS;
  return Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Math.round(n)));
}

export function clampPeriodWeeks(kind: PeriodKind, n: number): number {
  if (kind === "Term") return clampWeekCount(n);
  if (!Number.isFinite(n)) return MIN_FLEX_WEEKS;
  return Math.min(MAX_WEEKS, Math.max(MIN_FLEX_WEEKS, Math.round(n)));
}

function toUtc(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  return fromUtc(toUtc(ymd) + days * DAY_MS);
}

export function sundayOnOrBefore(ymd: string): string {
  const dow = new Date(toUtc(ymd)).getUTCDay();
  return addDays(ymd, -dow);
}

export function ymdFromDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function weekStart(period: BoardPeriod, week: number): string {
  return addDays(period.startDate, (week - 1) * 7);
}

export function weekEnd(period: BoardPeriod, week: number): string {
  return addDays(weekStart(period, week), 6);
}

export function periodEnd(period: BoardPeriod): string {
  return weekEnd(period, period.weekCount);
}

export function taskDate(period: BoardPeriod, week: number, weekday: number): string {
  return addDays(weekStart(period, week), weekday);
}

export function locateWeek(periods: BoardPeriod[], ymd: string): WeekRef | null {
  for (const period of periods) {
    if (ymd < period.startDate || ymd > periodEnd(period)) continue;
    const week = Math.floor((toUtc(ymd) - toUtc(period.startDate)) / (7 * DAY_MS)) + 1;
    return { periodId: period.id, week };
  }
  return null;
}

export type CurrentPosition = WeekRef & { between: boolean };

export function currentPosition(
  periods: BoardPeriod[],
  todayYmd: string,
): CurrentPosition | null {
  if (periods.length === 0) return null;
  const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const hit = locateWeek(sorted, todayYmd);
  if (hit) return { ...hit, between: false };
  const next = sorted.find((p) => p.startDate > todayYmd);
  if (next) return { periodId: next.id, week: 1, between: true };
  const last = sorted[sorted.length - 1];
  return { periodId: last.id, week: last.weekCount, between: true };
}

export type WeekRelation = "past" | "current" | "next" | "future";

export function relationToCurrent(
  periods: BoardPeriod[],
  viewed: WeekRef,
  current: WeekRef,
): WeekRelation {
  const byId = new Map(periods.map((p) => [p.id, p]));
  const v = byId.get(viewed.periodId);
  const c = byId.get(current.periodId);
  if (!v || !c) return "future";
  const vs = weekStart(v, viewed.week);
  const cs = weekStart(c, current.week);
  if (vs < cs) return "past";
  if (vs === cs) return "current";
  return vs === addDays(cs, 7) ? "next" : "future";
}

export function sortPeriods<T extends { startDate: string }>(periods: T[]): T[] {
  return [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function termPeriodFromDates(args: {
  start: Date;
  end: Date;
}): { startDate: string; weekCount: number } {
  const startDate = sundayOnOrBefore(args.start.toISOString().slice(0, 10));
  const end = args.end.toISOString().slice(0, 10);
  const days = (toUtc(end) - toUtc(startDate)) / DAY_MS + 1;
  return { startDate, weekCount: clampWeekCount(Math.ceil(days / 7)) };
}
