const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(raw: string | null | undefined): raw is string {
  return !!raw && DAY_RE.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`));
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return dayKey(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
}

/** Every UTC day from `from` to `to`, both included. */
export function dayKeys(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** A drag's two ends in time order, or null when it never left one day. */
export function orderedRange(a: string, b: string): { from: string; to: string } | null {
  if (a === b) return null;
  return a < b ? { from: a, to: b } : { from: b, to: a };
}

export function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function rangeLabel(from: string, to: string): string {
  return `${shortDay(from)} to ${shortDay(to)}`;
}

/** Rows for each day in [from, to], zero-filled where `rows` has no entry. */
export function fillDays<T extends { day: string }>(from: string, to: string, rows: T[], empty: Omit<T, "day">): T[] {
  const map = new Map(rows.map((r) => [r.day, r]));
  return dayKeys(from, to).map((day) => map.get(day) ?? ({ ...empty, day } as T));
}
