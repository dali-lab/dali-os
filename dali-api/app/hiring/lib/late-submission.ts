// Client-safe: whether a submission landed after its domain closed, and by how much.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function lateByMs(submittedAt: Date | string | null, closeDate: Date | null): number | null {
  if (!submittedAt || !closeDate) return null;
  const ms = new Date(submittedAt).getTime() - closeDate.getTime();
  return ms > 0 ? ms : null;
}

export function formatLateBy(ms: number): string {
  if (ms < HOUR) return `Late by ${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < 2 * DAY) return `Late by ${Math.round(ms / HOUR)}h`;
  return `Late by ${Math.round(ms / DAY)}d`;
}

export function lateByLabel(submittedAt: Date | string | null, closeDate: Date | null): string | null {
  const ms = lateByMs(submittedAt, closeDate);
  return ms == null ? null : formatLateBy(ms);
}
