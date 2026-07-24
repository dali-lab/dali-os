import { prisma } from "~/lib/db";

/**
 * Sync the calendar/working-hours zone (UserAvailabilitySettings.timezone) to a
 * new display zone — but ONLY when the user has no saved working-hours segments.
 * Working hours are stored as minutes-from-local-midnight interpreted in that
 * zone, so changing it under existing segments would silently shift their
 * meaning (a 9–5 block becomes a different window). Shared by the profile action
 * and the timezone-change prompt so both stay consistent.
 */
export async function syncAvailabilityTimezone(
  userId: string,
  timeZone: string,
): Promise<void> {
  const savedWorkingHours = await prisma.workingHoursDay.count({ where: { userId } });
  if (savedWorkingHours > 0) return;
  await prisma.userAvailabilitySettings.upsert({
    where: { userId },
    update: { timezone: timeZone },
    create: { userId, timezone: timeZone },
  });
}
