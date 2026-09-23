import { zonedDayStartUtc, zonedWallTimeUtc } from "~/lib/timezone";
import { prisma } from "~/lib/db";
import { computeUserFreeBusy, intersectFreeIntervals, type Interval } from "~/lib/availability";

// Interviewer availability for scheduling, read straight from each member's
// DALI OS calendar (there's no separate availability to fill in), plus the
// interview window's UTC bounds.

/** UTC bounds [start, end) of the configured interview window in `timezone`.
 * The stored `interviewStartDate`/`interviewEndDate` are UTC-midnight stamps
 * that stand for plain calendar dates (the picker sends a date-only value), so
 * we read their Y/M/D in UTC — NOT in `timezone`, which would shift the date to
 * the previous day for any zone west of UTC and slide the whole window off by a
 * day. We then anchor midnight-on-startDate and midnight-on-(endDate+1) in the
 * configured timezone. */
export function interviewWindowUtcBounds(config: {
  interviewStartDate: Date;
  interviewEndDate: Date;
  timezone: string;
}): { start: Date; end: Date } {
  const s = config.interviewStartDate;
  const e = config.interviewEndDate;
  const start = zonedDayStartUtc(
    s.getUTCFullYear(),
    s.getUTCMonth() + 1,
    s.getUTCDate(),
    config.timezone,
  );
  // End is exclusive — the day after `interviewEndDate`.
  const endNext = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()));
  endNext.setUTCDate(endNext.getUTCDate() + 1);
  const end = zonedDayStartUtc(
    endNext.getUTCFullYear(),
    endNext.getUTCMonth() + 1,
    endNext.getUTCDate(),
    config.timezone,
  );
  return { start, end };
}

export type InterviewWindowConfig = {
  interviewStartDate: Date;
  interviewEndDate: Date;
  timezone: string;
  dayStartHour: number;
  dayEndHour: number;
};

export type InterviewerCalendar = {
  /** At least one linked calendar feeds busy time. */
  hasCalendar: boolean;
  /** Working hours are set in DALI OS (otherwise it treats every hour as work). */
  hasWorkingHours: boolean;
  /** Free time inside the interview window's weekdays and daily hours. */
  available: { startTime: Date; endTime: Date }[];
};

/** Each weekday of the window, from dayStartHour to dayEndHour, in the
 *  interview timezone. */
function interviewDayWindows(config: InterviewWindowConfig): Interval[] {
  const out: Interval[] = [];
  const day = new Date(Date.UTC(
    config.interviewStartDate.getUTCFullYear(),
    config.interviewStartDate.getUTCMonth(),
    config.interviewStartDate.getUTCDate(),
  ));
  const lastDay = new Date(Date.UTC(
    config.interviewEndDate.getUTCFullYear(),
    config.interviewEndDate.getUTCMonth(),
    config.interviewEndDate.getUTCDate(),
  ));
  for (; day <= lastDay; day.setUTCDate(day.getUTCDate() + 1)) {
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    // Weekday as seen in the interview timezone, read from noon so it can't
    // tip into a neighboring day.
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: config.timezone, weekday: "short" })
      .format(zonedWallTimeUtc(y, m, d, 12, 0, config.timezone));
    if (weekday === "Sat" || weekday === "Sun") continue;
    out.push({
      start: zonedWallTimeUtc(y, m, d, config.dayStartHour, 0, config.timezone),
      end: zonedWallTimeUtc(y, m, d, config.dayEndHour, 0, config.timezone),
    });
  }
  return out;
}

async function computeInterviewerCalendar(
  userId: string,
  config: InterviewWindowConfig,
): Promise<InterviewerCalendar> {
  const { start, end } = interviewWindowUtcBounds(config);
  const [freeBusy, workingHours] = await Promise.all([
    computeUserFreeBusy(userId, start, end, config.timezone),
    prisma.workingHoursDay.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  const hasWorkingHours = workingHours !== null;
  // With neither a calendar nor working hours, the calendar would call them
  // free around the clock. That's "unknown", not "free", so they aren't
  // offered to applicants until they set one up.
  if (!freeBusy.hasCalendar && !hasWorkingHours) {
    return { hasCalendar: false, hasWorkingHours: false, available: [] };
  }
  const available = intersectFreeIntervals([freeBusy.free, interviewDayWindows(config)]).map(
    (iv) => ({ startTime: iv.start, endTime: iv.end }),
  );
  return { hasCalendar: freeBusy.hasCalendar, hasWorkingHours, available };
}

// A cycle's slot list and the booking right after it read the same
// calendars; a short cache keeps that to one read of each linked calendar.
const CACHE_TTL_MS = 2 * 60_000;
const cache = new Map<string, { expires: number; value: Promise<InterviewerCalendar> }>();

/** Each interviewer's availability straight from their DALI OS calendar:
 *  working hours plus busy time on the calendars they've linked (DALI
 *  meetings live on those too), limited to the interview window. */
export async function interviewerCalendars(
  userIds: string[],
  config: InterviewWindowConfig,
): Promise<Map<string, InterviewerCalendar>> {
  const now = Date.now();
  const unique = [...new Set(userIds)];
  const entries = await Promise.all(
    unique.map(async (userId) => {
      const key = [
        userId,
        config.interviewStartDate.toISOString(),
        config.interviewEndDate.toISOString(),
        config.timezone,
        config.dayStartHour,
        config.dayEndHour,
      ].join("|");
      let hit = cache.get(key);
      if (!hit || hit.expires < now) {
        const value = computeInterviewerCalendar(userId, config);
        hit = { expires: now + CACHE_TTL_MS, value };
        cache.set(key, hit);
        // A failed read shouldn't stick around for the whole TTL.
        value.catch(() => cache.delete(key));
      }
      return [userId, await hit.value] as const;
    }),
  );
  return new Map(entries);
}
