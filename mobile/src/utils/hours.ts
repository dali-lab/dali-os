import { format } from 'date-fns';

export const MAX_ENTRY_HOURS = 24;
export const MAX_NOTE_LENGTH = 500;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/** "yyyy-MM-dd" as local noon, so date-fns day math never lands on a neighbouring day. */
export function fromDateKey(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

export function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

/** 2.5 → "2h 30m" */
export function formatHours(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Seconds → "1:02:09" */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Seconds → "1:02" (hours:minutes) */
export function formatShortElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}`;
}

/** Seconds → "00:42" (minutes:seconds) */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** Seconds → "57 min" / "42s" */
export function formatRecordedLength(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)} min`;
}

/** Same rules DALI OS enforces server-side. */
export function validateRange(start: Date, end: Date): string | undefined {
  if (!(end.getTime() > start.getTime())) return 'End time must be after the start time.';
  if (hoursBetween(start, end) > MAX_ENTRY_HOURS) return 'An entry can’t be longer than 24 hours.';
  return undefined;
}
