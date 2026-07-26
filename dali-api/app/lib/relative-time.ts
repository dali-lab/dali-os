// Compact "3 minutes ago" formatting via the platform Intl API (no date dep).
// Shared by the version-history panel and the document metadata line.

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return RTF.format(-diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return RTF.format(-diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return RTF.format(-diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  return RTF.format(-diffDay, "day");
}
