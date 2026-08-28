// Pure helpers for the calendar search bar. The route (api.calendar.search)
// does the Postgres + Google reads; this module holds the query-window math and
// result ordering so they can be unit-tested without a DB or the Google API.

export type CalendarSearchSource = "meeting" | "block" | "google";

export type CalendarSearchHit = {
  // Stable within a source; used as a React key only.
  id: string;
  source: CalendarSearchSource;
  title: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  location: string | null;
  // A recurring item's startIso is its anchor occurrence, not necessarily the
  // next one; the UI flags it so the date reads as "starts …".
  recurring: boolean;
};

// How far past the current view to reach when searching Google in the default
// (near) scope. Local events are queried all-time, so this only bounds Google.
export const SEARCH_NEAR_PAD_MS = 14 * 86_400_000;

// The Google time window for a search. "near" pads the current view by two
// weeks each side; "all" opens a wide two-year window centered on now (Google
// requires a bound with singleEvents=true, so "all" isn't truly unbounded).
export function searchWindow(
  scope: "near" | "all",
  rangeStartIso: string,
  rangeEndIso: string,
  nowIso: string,
): { start: Date; end: Date } {
  if (scope === "all") {
    const now = new Date(nowIso).getTime();
    const TWO_YEARS = 2 * 365 * 86_400_000;
    return { start: new Date(now - TWO_YEARS), end: new Date(now + TWO_YEARS) };
  }
  return {
    start: new Date(new Date(rangeStartIso).getTime() - SEARCH_NEAR_PAD_MS),
    end: new Date(new Date(rangeEndIso).getTime() + SEARCH_NEAR_PAD_MS),
  };
}

// Upcoming events first (soonest → latest), then past events (most recent →
// oldest), relative to now. Puts "the next standup" at the top while keeping
// recent history reachable just below.
export function sortHits(hits: CalendarSearchHit[], nowIso: string): CalendarSearchHit[] {
  const now = new Date(nowIso).getTime();
  return [...hits].sort((a, b) => {
    const ta = new Date(a.startIso).getTime();
    const tb = new Date(b.startIso).getTime();
    const aFuture = ta >= now;
    const bFuture = tb >= now;
    if (aFuture !== bFuture) return aFuture ? -1 : 1;
    return aFuture ? ta - tb : tb - ta;
  });
}
