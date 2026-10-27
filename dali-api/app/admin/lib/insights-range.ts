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

export type InsightsWindow = {
  /** The preset in use, or null for a dragged custom range. */
  key: RangeKey | null;
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
export function resolveWindow(params: URLSearchParams, now = new Date()): InsightsWindow {
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
