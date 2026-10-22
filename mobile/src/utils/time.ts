import { addDays, differenceInMinutes, format, isSameDay, subDays } from 'date-fns';

export function now(): Date {
  return new Date();
}

export function toMs(value: string): number {
  return new Date(value).getTime();
}

export function formatClock(value: string | Date): string {
  return format(new Date(value), 'h:mm a');
}

export function formatListTime(value: string): string {
  const d = new Date(value);
  if (isSameDay(d, now())) return format(d, 'h:mm a');
  if (isSameDay(d, subDays(now(), 1))) return 'Yesterday';
  if (differenceInMinutes(now(), d) < 7 * 24 * 60) return format(d, 'EEE');
  return format(d, 'MMM d');
}

export function formatDayLabel(value: string | Date): string {
  const d = new Date(value);
  if (isSameDay(d, now())) return 'Today';
  if (isSameDay(d, subDays(now(), 1))) return 'Yesterday';
  if (isSameDay(d, addDays(now(), 1))) return 'Tomorrow';
  return format(d, 'EEEE, MMMM d');
}

export function formatTimeRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const sameMeridiem = format(s, 'a') === format(e, 'a');
  return `${format(s, sameMeridiem ? 'h:mm' : 'h:mm a')} – ${format(e, 'h:mm a')}`;
}

export function formatDuration(start: string, end: string): string {
  const mins = differenceInMinutes(new Date(end), new Date(start));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function formatCountdown(start: string): string {
  const mins = differenceInMinutes(new Date(start), now());
  if (mins <= 0) return 'Happening now';
  if (mins < 60) return `Starts in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `Starts in ${h} hr ${m} min` : `Starts in ${h} hr`;
}

export function formatShortDate(value: string): string {
  return format(new Date(value), 'MMM d');
}