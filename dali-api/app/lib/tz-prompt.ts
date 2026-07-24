// Device-scoped suppression for the "your timezone changed" prompt. Lives in a
// cookie (not a DB column) because dismissal is transient, per-browser nagging
// suppression rather than durable user state — a genuine relocation on a new
// device should re-prompt. The DURABLE part (the actual chosen tz) is persisted
// to User.timeZone by the same action. Mirrors lib/tabless.ts on purpose:
// self-contained, read server-side in the layout loader so there's no flash.
//
// The value stored is the IANA zone the user chose to KEEP (i.e. dismissed
// against). We re-prompt only when the freshly detected browser zone differs
// from BOTH the stored preference and this dismissed zone.

export const TZ_DISMISSED_COOKIE = "dali_tz_dismissed";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function readCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k?.trim() === name) return decodeURIComponent(rest.join("=").trim());
  }
  return null;
}

/** The zone the user last dismissed the prompt against, or null. */
export function readDismissedTimeZone(request: Request): string | null {
  return readCookie(request.headers.get("Cookie") ?? "", TZ_DISMISSED_COOKIE) || null;
}

/** Set-Cookie header value recording that the prompt was dismissed against `tz`. */
export function dismissedTimeZoneCookie(tz: string): string {
  return `${TZ_DISMISSED_COOKIE}=${encodeURIComponent(tz)}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}
