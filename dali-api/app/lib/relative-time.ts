// Compact "3 minutes ago" formatting via the platform Intl API (no date dep).
// Shared by the version-history panel and the document metadata line.

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const SAME_YEAR = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const OTHER_YEAR = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

/** Past a month either way, a count of days stops meaning anything; the date itself is shorter and clearer. */
const MAX_RELATIVE_DAYS = 30;

export function relativeTime(iso: string): string {
  const date = new Date(iso);
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  const sign = diffSec < 0 ? 1 : -1;
  const abs = Math.abs(diffSec);
  if (abs < 60) return RTF.format(sign * abs, "second");
  const diffMin = Math.round(abs / 60);
  if (diffMin < 60) return RTF.format(sign * diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return RTF.format(sign * diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  if (diffDay <= MAX_RELATIVE_DAYS) return RTF.format(sign * diffDay, "day");
  return (date.getFullYear() === new Date().getFullYear() ? SAME_YEAR : OTHER_YEAR).format(date);
}
