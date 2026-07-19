// Mentor notes are weekly, addressed by the Monday-UTC start-of-week date.
// Anywhere a "week" is named in code, we collapse the wall-clock day to the
// Monday of that ISO week in UTC so two clients on different timezones can't
// produce different MentorNote rows for the same lab week.

export function startOfWeekUTC(d: Date | string): Date {
  const date = typeof d === "string" ? new Date(d) : new Date(d.getTime());
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  // Shift so Monday becomes index 0 (Sun → 6 → -6 days from current day-of-week).
  const diff = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function currentWeekStart(): Date {
  return startOfWeekUTC(new Date());
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Term weeks are numbered from the Monday-week containing the term's start:
// that Monday is Week 1. A weekOf date maps to (weeksSinceWeek1 + 1). Notes
// store the Monday-UTC weekOf; the term supplies the origin.
export function weekNumberInTerm(weekOf: Date | string, termStart: Date | string): number {
  const w = startOfWeekUTC(weekOf).getTime();
  const origin = startOfWeekUTC(termStart).getTime();
  return Math.floor((w - origin) / WEEK_MS) + 1;
}

// Inverse of weekNumberInTerm: the Monday-UTC date for week N of a term.
export function weekStartForNumber(termStart: Date | string, week: number): Date {
  const origin = startOfWeekUTC(termStart);
  origin.setUTCDate(origin.getUTCDate() + (week - 1) * 7);
  return origin;
}

// How many numbered weeks a term spans (Week 1 .. Week N), min 1. DALI terms
// run ~10 weeks; this derives the exact count from the term's own dates.
export function weeksInTerm(termStart: Date | string, termEnd: Date | string): number {
  return Math.max(1, weekNumberInTerm(termEnd, termStart));
}
