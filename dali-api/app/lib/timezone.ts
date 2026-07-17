/** The lab's application timezone. Cycle close dates anchor to this zone. */
export const APPLICATION_TZ = "America/New_York";
/** Short label shown next to displayed application close dates/times. */
export const APPLICATION_TZ_LABEL = "ET";

/**
 * Human-readable instant in the lab's timezone, for server-rendered copy
 * (Slack DMs, reminder emails). The server runs UTC on Fly — never format
 * with server-local time there.
 */
export function formatApplicationDateTime(date: Date): string {
  const text = date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: APPLICATION_TZ,
  });
  return `${text} ${APPLICATION_TZ_LABEL}`;
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Year/month/day of `date` interpreted in `timezone` (month is 1-indexed). */
export function getZonedYMD(
  date: Date,
  timezone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value ?? "0"),
    month: Number(parts.find((p) => p.type === "month")?.value ?? "0"),
    day: Number(parts.find((p) => p.type === "day")?.value ?? "0"),
  };
}

/** Wall-clock parts of `date` interpreted in `timezone` (month 1-indexed). */
export function getZonedParts(
  date: Date,
  timezone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/**
 * Hour-of-day of `date` interpreted in `timezone`, as a fraction in [0, 24)
 * (e.g. 2:30 PM → 14.5). Used to position the calendar's "current time" line.
 */
export function getZonedHourFraction(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour + minute / 60;
}

/**
 * UTC instant corresponding to the last second of `year-month-day` in
 * `timezone` (i.e. 23:59:59 local). Computed as next-day midnight minus 1s so
 * DST transition days resolve correctly.
 */
export function zonedDayEndUtc(
  year: number,
  month: number,
  day: number,
  timezone: string,
): Date {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextStart = zonedDayStartUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timezone,
  );
  return new Date(nextStart.getTime() - 1000);
}

/** UTC instant corresponding to local midnight on `year-month-day` in `timezone`. */
/**
 * UTC instant corresponding to a wall-clock time `year-month-day hour:minute`
 * in `timezone`. DST-correct: probes the zone's offset at the guessed instant
 * and corrects, which resolves transition days the same way the rest of this
 * module does. The single source of truth for "this local time means this UTC
 * instant" — `zonedDayStartUtc` is the hour=0, minute=0 case.
 */
export function zonedWallTimeUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(utcGuess);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0");
  const localAtUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  const offsetMs = localAtUtcMs - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offsetMs);
}

export function zonedDayStartUtc(
  year: number,
  month: number,
  day: number,
  timezone: string,
): Date {
  return zonedWallTimeUtc(year, month, day, 0, 0, timezone);
}
