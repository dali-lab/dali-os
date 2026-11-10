import { addDays, dayKey, daysInclusive, isDayKey, rangeLabel } from "~/components/analytics/chart-range";

export const RANGE_OPTIONS = [
  { key: "7d", days: 7, label: "7 days" },
  { key: "30d", days: 30, label: "30 days" },
  { key: "90d", days: 90, label: "90 days" },
] as const;

export type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];
export const DEFAULT_RANGE: RangeKey = "30d";

export function resolveRange(raw: string | null) {
  return RANGE_OPTIONS.find((r) => r.key === raw) ?? RANGE_OPTIONS[1];
}

/** Insights only: the infra charts that share RANGE_OPTIONS stay on presets. */
export const ALL_TIME = { key: "all", label: "All time" } as const;
export const INSIGHTS_RANGE_OPTIONS = [...RANGE_OPTIONS, ALL_TIME] as const;
export type InsightsRangeKey = RangeKey | typeof ALL_TIME.key;

export function wantsAllTime(params: URLSearchParams): boolean {
  return params.get("range") === ALL_TIME.key;
}

export type InsightsWindow = {
  /** The preset in use, or null for a dragged custom range. */
  key: InsightsRangeKey | null;
  since: Date;
  until: Date;
  firstDay: string;
  lastDay: string;
  days: number;
  /** "Last 30 days" or "Oct 3 to Oct 10", for headings. */
  label: string;
  /** "the last 30 days" or "Oct 3 to Oct 10", for sentences. */
  phrase: string;
};

/**
 * `?from=&to=` (UTC days, both included) wins over `?range=` when both ends
 * are valid days in order and not in the future.
 */
export function resolveWindow(
  params: URLSearchParams,
  now = new Date(),
  /** Oldest recorded row, so `?range=all` charts from the first day of data. */
  earliest: Date | null = null,
): InsightsWindow {
  const today = dayKey(now);
  const from = params.get("from");
  const to = params.get("to");
  if (isDayKey(from) && isDayKey(to) && from <= to && to <= today) {
    const label = rangeLabel(from, to);
    return {
      key: null,
      since: new Date(`${from}T00:00:00Z`),
      until: new Date(`${addDays(to, 1)}T00:00:00Z`),
      firstDay: from,
      lastDay: to,
      days: daysInclusive(from, to),
      label,
      phrase: label,
    };
  }
  if (wantsAllTime(params)) {
    const firstDay = earliest && dayKey(earliest) < today ? dayKey(earliest) : today;
    return {
      key: ALL_TIME.key,
      since: new Date(0),
      until: new Date(`${addDays(today, 1)}T00:00:00Z`),
      firstDay,
      lastDay: today,
      days: daysInclusive(firstDay, today),
      label: ALL_TIME.label,
      phrase: "the full history",
    };
  }
  const range = resolveRange(params.get("range"));
  return {
    key: range.key,
    since: new Date(now.getTime() - range.days * 86_400_000),
    until: new Date(`${addDays(today, 1)}T00:00:00Z`),
    firstDay: addDays(today, -(range.days - 1)),
    lastDay: today,
    days: range.days,
    label: `Last ${range.label}`,
    phrase: `the last ${range.label}`,
  };
}
