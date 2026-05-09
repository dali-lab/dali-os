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
export function zonedDayStartUtc(
  year: number,
  month: number,
  day: number,
  timezone: string,
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day));
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
