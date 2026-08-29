import { APPLICATION_TZ, formatInTimeZone } from "~/lib/timezone";

/** "Jane Smith" -> "JS"; "Jane" -> "JA"; "" -> "?". */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Two-letter initials derived from a user object. */
export function userInitials(user: {
  firstName?: string;
  lastName?: string;
  email: string;
}): string {
  if (user.firstName || user.lastName) {
    const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`;
    return initialsFromName(fullName);
  }
  const localPart = user.email.split("@")[0] ?? user.email;
  return initialsFromName(localPart);
}

// Sentinel-string policy:
//   UNKNOWN_LABEL ("Unknown") → human prose ("Created by Unknown")
//   EMPTY_DISPLAY ("—")       → table cells / structured data
export const UNKNOWN_LABEL = "Unknown";
export const EMPTY_DISPLAY = "—";

const SEASON_NAMES: Record<string, string> = {
  W: "Winter",
  S: "Spring",
  X: "Summer",
  F: "Fall",
};

/** "26S" -> "Spring 2026". Partner-facing surfaces spell term codes out; the
 * member app keeps lab vocabulary ("26S") verbatim. Unrecognized codes pass
 * through unchanged. */
export function termCodeLabel(code: string): string {
  const m = /^(\d{2})([WSXF])$/.exec(code);
  if (!m) return code;
  return `${SEASON_NAMES[m[2]!]} 20${m[1]}`;
}

// TODO: import from app-env.ts once available
const DARTMOUTH_EMAIL_DOMAIN_FALLBACK = "dartmouth.edu";

export function fullName(user: { firstName?: string | null; lastName?: string | null }): string {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
}

export function primaryEmail(user: {
  daliEmail?: string | null;
  dartmouthEmail?: string | null;
  personalEmail?: string | null;
}): string | null {
  return user.daliEmail || user.dartmouthEmail || user.personalEmail || null;
}

export function displayEmail(user: {
  daliEmail?: string | null;
  dartmouthEmail?: string | null;
  netId?: string | null;
  personalEmail?: string | null;
}): string {
  const primary = user.daliEmail || user.dartmouthEmail || user.personalEmail;
  if (primary) return primary;
  if (user.netId) return `${user.netId}@${DARTMOUTH_EMAIL_DOMAIN_FALLBACK}`;
  return "";
}

// Timestamp formatters take an explicit IANA `timeZone` so the server (UTC on
// Fly) and the client render byte-identical strings — no SSR hydration mismatch.
// Client callers pass useUserTimeZone(); server callers pass
// resolveUserTimeZone(user). Omitting it falls back to the lab zone (ET) rather
// than the host-local zone, which would be hydration-fragile.
export function formatDateTime(iso: string | Date, timeZone: string = APPLICATION_TZ): string {
  const d = new Date(iso);
  return formatInTimeZone(d, timeZone, { month: "short", day: "numeric", year: "numeric" })
    + " at " + formatInTimeZone(d, timeZone, { hour: "numeric", minute: "2-digit" });
}

export function formatDateShort(iso: string | Date, timeZone: string = APPLICATION_TZ): string {
  return formatInTimeZone(iso, timeZone, { month: "short", day: "numeric", year: "numeric" });
}

/** "2:00 PM" in the given zone — just the clock time, no date. */
export function formatTimeOnly(iso: string | Date, timeZone: string = APPLICATION_TZ): string {
  return formatInTimeZone(iso, timeZone, { hour: "numeric", minute: "2-digit" });
}

/**
 * A session's when, collapsed to one line: "Aug 29, 2026 at 2:00 PM" with no
 * end, or "Aug 29, 2026 · 2:00 – 3:00 PM" when an end is set on the same day.
 * A rare cross-midnight end falls back to spelling both datetimes in full.
 */
export function formatSessionWhen(
  start: string | Date,
  end: string | Date | null | undefined,
  timeZone: string = APPLICATION_TZ,
): string {
  if (!end) return formatDateTime(start, timeZone);
  if (formatDateShort(start, timeZone) !== formatDateShort(end, timeZone)) {
    return `${formatDateTime(start, timeZone)} – ${formatDateTime(end, timeZone)}`;
  }
  return `${formatDateShort(start, timeZone)} · ${formatTimeOnly(start, timeZone)} – ${formatTimeOnly(end, timeZone)}`;
}
