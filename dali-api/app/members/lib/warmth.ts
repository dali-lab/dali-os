const MS_PER_DAY = 86_400_000;

/** True when the member joined within the last 30 days. Caller ensures
 *  the member is active (not alumni). */
export function isNewMember(
  member: { onboardedAt: Date | null; createdAt: Date },
  now: Date,
): boolean {
  const anchor = member.onboardedAt ?? member.createdAt;
  return now.getTime() - anchor.getTime() < 30 * MS_PER_DAY;
}

/** True when the member's birthday (month + day) matches today, regardless of year. */
export function isBirthdayToday(birthday: Date | null, now: Date): boolean {
  if (!birthday) return false;
  return (
    birthday.getUTCMonth() === now.getUTCMonth() &&
    birthday.getUTCDate() === now.getUTCDate()
  );
}

/** "Mar 12" — month and day only, never the year. Birthday must be non-null. */
export function formatBirthdayMonthDay(birthday: Date): string {
  return birthday.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Members whose (UTC) birthday falls within the current Sunday–Saturday week.
 *  Year-agnostic: compares month+day pairs against the 7 dates in the window.
 *  Correctly handles a week that straddles a month boundary. */
export function birthdaysThisWeek<T extends { birthday: Date | null }>(
  members: T[],
  now: Date,
): T[] {
  // Build the 7 {month, day} pairs for the current week (Sun → Sat).
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // Sunday of this week
  const dow = todayUtc.getUTCDay();
  const sundayUtc = new Date(todayUtc.getTime() - dow * MS_PER_DAY);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sundayUtc.getTime() + i * MS_PER_DAY);
    return { month: d.getUTCMonth(), day: d.getUTCDate() };
  });

  return members.filter((m) => {
    if (!m.birthday) return false;
    const bMonth = m.birthday.getUTCMonth();
    const bDay = m.birthday.getUTCDate();
    return weekDays.some((wd) => wd.month === bMonth && wd.day === bDay);
  });
}
