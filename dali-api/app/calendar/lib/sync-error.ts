// A UserCalendarLink.syncError holds the raw Google/API error string from the
// last failed sync (e.g. "Google events.list failed (403): insufficientPermissions:
// Request had insufficient authentication scopes."). Classify the common,
// user-fixable case — a token that never got the calendar scope — so the UI can
// show an actionable "reconnect" prompt instead of a raw 403.

// Where the "Add account" / "Reconnect" links point. `target="_top"` is
// required at the call site: Google's auth page sends X-Frame-Options: DENY and
// can't render inside the workspace iframe.
export const CALENDAR_CONNECT_URL = "/oauth/calendar/google/start";

export interface CalendarSyncErrorInfo {
  /** The raw stored string, for the title attribute / debugging. */
  raw: string;
  /** Human-facing message to render. */
  message: string;
  /** True when re-running the OAuth flow (and granting calendar access) fixes it. */
  needsReconnect: boolean;
}

export function describeCalendarSyncError(
  syncError: string | null | undefined,
): CalendarSyncErrorInfo | null {
  if (!syncError) return null;

  // Google phrases this a couple of ways: the OAuth-level reason
  // "insufficientPermissions" and the human message "insufficient authentication
  // scopes". A bare 403 that also mentions a scope is the same failure.
  const insufficientScopes =
    /insufficient\s*permissions/i.test(syncError) ||
    /insufficient authentication scopes/i.test(syncError) ||
    (/\b403\b/.test(syncError) && /scope/i.test(syncError));

  if (insufficientScopes) {
    return {
      raw: syncError,
      message:
        "This account didn't grant calendar access. Reconnect it and allow the Calendar permission so DALI can read its events.",
      needsReconnect: true,
    };
  }

  return { raw: syncError, message: `Sync error: ${syncError}`, needsReconnect: false };
}
