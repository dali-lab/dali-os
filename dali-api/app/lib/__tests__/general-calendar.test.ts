import { describe, it, expect, afterEach, vi } from "vitest";
import {
  fetchGeneralCalendarEvents,
  generalCalendarConfigured,
  warmGeneralCalendarFeed,
} from "../general-calendar";

const ENV = process.env.DALI_GENERAL_CALENDAR_ICS;
afterEach(() => {
  if (ENV === undefined) delete process.env.DALI_GENERAL_CALENDAR_ICS;
  else process.env.DALI_GENERAL_CALENDAR_ICS = ENV;
  vi.restoreAllMocks();
});

function mockFetchIcs(body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, text: async () => body } as Response),
  );
}

// The ICS fetch is off the request path (stale-while-revalidate): a cold cache
// serves nothing and refreshes in the background, so the read never blocks. Tests
// that assert on parsed events prime the cache first via the startup-warm helper,
// which awaits the fetch, then read from the now-warm cache.
async function primeAndRead(body: string) {
  mockFetchIcs(body);
  await warmGeneralCalendarFeed();
  return fetchGeneralCalendarEvents(WINDOW_START, WINDOW_END);
}

const WINDOW_START = new Date("2026-05-24T00:00:00Z");
const WINDOW_END = new Date("2026-05-31T00:00:00Z");

// The parsed feed is cached at module level, keyed by URL — each test uses its
// own URL so cached results from one test can't leak into another.

describe("generalCalendarConfigured", () => {
  it("is false without the env var", () => {
    delete process.env.DALI_GENERAL_CALENDAR_ICS;
    expect(generalCalendarConfigured()).toBe(false);
  });
  it("is true with the env var", () => {
    process.env.DALI_GENERAL_CALENDAR_ICS = "https://example.com/cal.ics";
    expect(generalCalendarConfigured()).toBe(true);
  });
});

describe("fetchGeneralCalendarEvents", () => {
  it("returns [] when unconfigured (never fetches)", async () => {
    delete process.env.DALI_GENERAL_CALENDAR_ICS;
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    const events = await fetchGeneralCalendarEvents(WINDOW_START, WINDOW_END);
    expect(events).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("parses a UTC timed event inside the window", async () => {
    process.env.DALI_GENERAL_CALENDAR_ICS = "https://example.com/utc.ics";
    const events = await primeAndRead(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "SUMMARY:Lab Meeting",
        "DTSTART:20260526T180000Z",
        "DTEND:20260526T190000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Lab Meeting");
    expect(events[0].allDay).toBe(false);
    expect(events[0].start.toISOString()).toBe("2026-05-26T18:00:00.000Z");
  });

  it("unfolds folded lines and unescapes the summary", async () => {
    process.env.DALI_GENERAL_CALENDAR_ICS = "https://example.com/folded.ics";
    const events = await primeAndRead(
      // RFC 5545 folding: a continuation line begins with one space/tab which
      // is the fold marker and is dropped on unfold. So "...room 2 " + fold +
      // "(bring..." rejoins as "...room 2 (bring...".
      [
        "BEGIN:VEVENT",
        "SUMMARY:Design crit\\, room 2 ",
        " (bring laptops)",
        "DTSTART:20260527T140000Z",
        "DTEND:20260527T150000Z",
        "END:VEVENT",
      ].join("\r\n"),
    );
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Design crit, room 2 (bring laptops)");
  });

  it("flags an all-day (date-only) event", async () => {
    process.env.DALI_GENERAL_CALENDAR_ICS = "https://example.com/all-day.ics";
    const events = await primeAndRead(
      ["BEGIN:VEVENT", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20260525", "END:VEVENT"].join("\r\n"),
    );
    expect(events).toHaveLength(1);
    expect(events[0].allDay).toBe(true);
  });

  it("excludes events outside the window", async () => {
    process.env.DALI_GENERAL_CALENDAR_ICS = "https://example.com/windowed.ics";
    const events = await primeAndRead(
      [
        "BEGIN:VEVENT",
        "SUMMARY:Last week",
        "DTSTART:20260517T180000Z",
        "DTEND:20260517T190000Z",
        "END:VEVENT",
      ].join("\r\n"),
    );
    expect(events).toEqual([]);
  });

  it("returns [] (doesn't throw) on a non-ok response with no cached feed", async () => {
    process.env.DALI_GENERAL_CALENDAR_ICS = "https://example.com/non-ok.ics";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false } as Response));
    await expect(fetchGeneralCalendarEvents(WINDOW_START, WINDOW_END)).resolves.toEqual([]);
  });

  it("expands a weekly RRULE into the current-week occurrence", async () => {
    process.env.DALI_GENERAL_CALENDAR_ICS = "https://example.com/rrule.ics";
    // Weekly Monday standup anchored well before the window. The window is
    // 2026-05-24 (Sun) .. 2026-05-31 (Sun), so the Monday occurrence is 05-25.
    const events = await primeAndRead(
      [
        "BEGIN:VEVENT",
        "SUMMARY:Weekly Standup",
        "DTSTART:20260105T150000Z",
        "DTEND:20260105T153000Z",
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "END:VEVENT",
      ].join("\r\n"),
    );
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Weekly Standup");
    expect(events[0].start.toISOString()).toBe("2026-05-25T15:00:00.000Z");
    // Duration (30 min) is preserved on the occurrence.
    expect(events[0].end.toISOString()).toBe("2026-05-25T15:30:00.000Z");
  });

  it("resolves a TZID local time to the right UTC instant", async () => {
    process.env.DALI_GENERAL_CALENDAR_ICS = "https://example.com/tzid.ics";
    // 14:00 America/New_York on 2026-05-26 is EDT (UTC-4) → 18:00Z.
    const events = await primeAndRead(
      [
        "BEGIN:VEVENT",
        "SUMMARY:Tz event",
        "DTSTART;TZID=America/New_York:20260526T140000",
        "DTEND;TZID=America/New_York:20260526T150000",
        "END:VEVENT",
      ].join("\r\n"),
    );
    expect(events).toHaveLength(1);
    expect(events[0].start.toISOString()).toBe("2026-05-26T18:00:00.000Z");
  });

  it("caches the feed within the TTL and serves it stale while it revalidates", async () => {
    process.env.DALI_GENERAL_CALENDAR_ICS = "https://example.com/cached.ics";
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        [
          "BEGIN:VEVENT",
          "SUMMARY:Lab Meeting",
          "DTSTART:20260526T180000Z",
          "DTEND:20260526T190000Z",
          "END:VEVENT",
        ].join("\r\n"),
    } as Response);
    vi.stubGlobal("fetch", fetchFn);

    // Prime the cache off the request path (the read never blocks on the fetch).
    await warmGeneralCalendarFeed();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Reads inside the TTL are served from cache with no refetch.
    await expect(fetchGeneralCalendarEvents(WINDOW_START, WINDOW_END)).resolves.toHaveLength(1);
    await expect(fetchGeneralCalendarEvents(WINDOW_START, WINDOW_END)).resolves.toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Past the TTL the stale feed is served immediately while a background
    // refresh is kicked off — the read still returns the (stale) events, and it
    // never awaits the network. When that refresh fails, the stale feed stands.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60_000);
    fetchFn.mockResolvedValue({ ok: false } as Response);
    await expect(fetchGeneralCalendarEvents(WINDOW_START, WINDOW_END)).resolves.toHaveLength(1);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    // Stale feed is still served after the failed background refresh.
    await expect(fetchGeneralCalendarEvents(WINDOW_START, WINDOW_END)).resolves.toHaveLength(1);
  });
});
