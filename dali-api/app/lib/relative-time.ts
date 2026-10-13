// Compact "3 minutes ago" formatting via the platform Intl API (no date dep).
// Shared by the version-history panel and the document metadata line.

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(iso: string): string {
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const sign = diffSec < 0 ? 1 : -1;
  const abs = Math.abs(diffSec);
  if (abs < 60) return RTF.format(sign * abs, "second");
  const diffMin = Math.round(abs / 60);
  if (diffMin < 60) return RTF.format(sign * diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return RTF.format(sign * diffHr, "hour");
  return RTF.format(sign * Math.round(diffHr / 24), "day");
}
