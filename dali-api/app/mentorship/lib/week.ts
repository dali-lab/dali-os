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
