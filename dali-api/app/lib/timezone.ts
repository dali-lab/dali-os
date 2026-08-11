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

/**
 * Effective scheduling zone for a user. The calendar/working-hours zone wins —
 * working hours are stored relative to it — then the user's display zone, then
 * the lab default.
 */
export function pickUserTimezone(
  settingsTimezone: string | null | undefined,
  displayTimezone: string | null | undefined,
  fallback: string = APPLICATION_TZ,
): string {
  if (isValidTimezone(settingsTimezone)) return settingsTimezone;
  if (isValidTimezone(displayTimezone)) return displayTimezone;
  return fallback;
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

/**
 * The timezone a user's times should be DISPLAYED in. `User.timeZone` is the
 * single source of truth; falls back to the lab's application timezone when the
 * user has never set one or the stored value is invalid. Guarding here protects
 * every call site from a bad stored IANA string.
 */
export function resolveUserTimeZone(
  user: { timeZone?: string | null } | null | undefined,
): string {
  return isValidTimezone(user?.timeZone) ? user!.timeZone! : APPLICATION_TZ;
}

/**
 * Format an instant in an explicit IANA zone. The shared primitive for all
 * tz-aware display: because the zone is explicit (never the runtime's local
 * zone), the server (UTC on Fly) and the client produce identical strings, so
 * SSR hydration stays consistent.
 */
export function formatInTimeZone(
  date: string | Date,
  timezone: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timezone }).format(
    new Date(date),
  );
}

/** "Mar 5, 2026 at 2:30 PM" in `timezone`. tz-aware twin of display.ts formatDateTime. */
export function formatDateTimeInZone(date: string | Date, timezone: string): string {
  const d = new Date(date);
  const datePart = formatInTimeZone(d, timezone, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = formatInTimeZone(d, timezone, { hour: "numeric", minute: "2-digit" });
  return `${datePart} at ${timePart}`;
}

/** "Mar 5, 2026" in `timezone`. tz-aware twin of display.ts formatDateShort. */
export function formatDateShortInZone(date: string | Date, timezone: string): string {
  return formatInTimeZone(date, timezone, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * "Thu, Jul 20, 2:30 PM EDT" — a concise instant with a dynamic zone
 * abbreviation, for per-recipient server copy (reminder notifications) formatted
 * in each recipient's own zone. Distinct from formatApplicationDateTime, which
 * always pins ET for applicant/cycle-facing text.
 */
export function formatInstantWithZoneLabel(date: string | Date, timezone: string): string {
  const text = formatInTimeZone(date, timezone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const abbrev =
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" })
      .formatToParts(new Date(date))
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  return abbrev ? `${text} ${abbrev}` : text;
}

/**
 * "Today" / "Yesterday" / a formatted date, with the day boundary computed in
 * `timezone` (not the host's local day) so bucketing is correct for the viewer.
 */
export function zonedDayLabel(
  date: string | Date,
  now: Date,
  timezone: string,
  fallbackOpts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" },
): string {
  const d = new Date(date);
  const a = getZonedYMD(d, timezone);
  const b = getZonedYMD(now, timezone);
  const diffDays = Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) /
      86_400_000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return formatInTimeZone(d, timezone, fallbackOpts);
}

/**
 * Friendly, human label for a stored IANA zone, e.g. "Pacific Time · Los Angeles
 * (UTC-7)". For read-only display (the profile). Falls back to the raw zone if
 * invalid.
 */
export function formatZoneLabel(timezone: string | null | undefined): string {
  if (!isValidTimezone(timezone)) return timezone ?? "";
  const now = new Date();
  const generic =
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longGeneric" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const offset = (
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? ""
  ).replace("GMT", "UTC");
  const city = timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone;
  const left = generic && generic !== city ? `${generic} · ${city}` : city;
  return offset ? `${left} (${offset})` : left;
}

function timeWithAbbrev(d: Date, timezone: string): { time: string; abbrev: string } {
  const time = formatInTimeZone(d, timezone, { hour: "numeric", minute: "2-digit" });
  const abbrev =
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  return { time, abbrev };
}

/**
 * Dual-time string anchored to `anchorTz` with the viewer's local time appended,
 * e.g. "2:00 PM EDT · 11:00 AM your time (PDT)". Used for applicant-facing
 * interview times: the ET anchor is always shown (so an in-person Dartmouth
 * interview can't be misread) while a remote applicant still sees their own
 * clock. Collapses to the anchor alone when the viewer zone is unknown or
 * renders the same wall-clock time as the anchor.
 */
export function formatDualTime(
  date: string | Date,
  viewerTz: string | null | undefined,
  anchorTz: string,
): string {
  const d = new Date(date);
  const anchor = timeWithAbbrev(d, anchorTz);
  const anchorStr = `${anchor.time} ${anchor.abbrev}`.trim();
  if (!isValidTimezone(viewerTz) || viewerTz === anchorTz) return anchorStr;
  const viewer = timeWithAbbrev(d, viewerTz);
  if (viewer.time === anchor.time && viewer.abbrev === anchor.abbrev) return anchorStr;
  return `${anchorStr} · ${viewer.time} your time (${viewer.abbrev})`;
}
