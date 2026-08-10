// Reads the public "DALI General Calendar" iCal (.ics) feed for the home-page
// week calendar. This is intentionally account-independent: the calendar is
// made public in Google Calendar and we fetch its anonymous .ics URL, so there
// are no OAuth tokens, no secrets, and no dependency on any single user's
// Google account. The URL comes from the DALI_GENERAL_CALENDAR_ICS env var.
//
// We hand-parse the small subset of iCal we need (VEVENT SUMMARY/DTSTART/DTEND/
// RRULE) rather than add an ical dependency — the feed is simple and read-only.
// RRULE recurrences are expanded into concrete occurrences within the window
// via the `rrule` package (already used by ~/lib/availability).

import rrulePkg from "rrule";
import type { RRule as RRuleType } from "rrule";
import { zonedWallTimeUtc } from "~/lib/timezone";

const { RRule, rrulestr } = rrulePkg as unknown as {
  RRule: typeof import("rrule").RRule;
  rrulestr: typeof import("rrule").rrulestr;
};

export type GeneralCalendarEvent = {
  start: Date;
  end: Date;
  summary: string;
  allDay: boolean;
  // Optional VEVENT fields, carried through for the home calendar's detail
  // panel. Absent from most feed entries, so every one is nullable.
  location: string | null;
  description: string | null;
  organizer: string | null;
  /** Google puts the event's own web link in URL. */
  url: string | null;
};

// A parsed VEVENT before windowing/recurrence expansion.
type RawEvent = {
  start: Date;
  end: Date;
  summary: string;
  allDay: boolean;
  rrule: string | null;
  location: string | null;
  description: string | null;
  organizer: string | null;
  url: string | null;
};

const FETCH_TIMEOUT_MS = 5_000;

// TTL cache for the fetched+parsed feed (pre-windowing, so every week window
// shares one fetch) — the external HTTP fetch was on the critical path of every
// home load. A failed refresh serves the stale feed; concurrent callers share
// one in-flight fetch.
const CACHE_TTL_MS = 5 * 60_000;
let feedCache: { url: string; events: RawEvent[]; fetchedAt: number } | null = null;
let feedInflight: { url: string; promise: Promise<RawEvent[] | null> } | null = null;

export function generalCalendarConfigured(): boolean {
  return !!process.env.DALI_GENERAL_CALENDAR_ICS;
}

// Fetch the raw .ics text, returning parsed events or null on any fetch error.
async function fetchAndParseFeed(url: string): Promise<RawEvent[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return parseIcs(await res.text());
  } catch {
    return null;
  }
}

// Kick off a refresh (dedup any in-flight one) and return its promise. Updates
// the cache on success. Callers on the request path must NOT await this — see
// getFeed. Safe to await off the request path (startup warm).
function refreshFeed(url: string): Promise<RawEvent[] | null> {
  if (feedInflight && feedInflight.url === url) return feedInflight.promise;
  const promise = fetchAndParseFeed(url)
    .then((events) => {
      if (events) feedCache = { url, events, fetchedAt: Date.now() };
      return events;
    })
    .finally(() => {
      if (feedInflight?.promise === promise) feedInflight = null;
    });
  feedInflight = { url, promise };
  return promise;
}

// Stale-while-revalidate cached feed lookup. The external HTTP fetch must not be
// on the critical path of a home load — a slow/large .ics (seconds) blocked the
// whole home loader via its Promise.all, showing up as multi-second navigation
// TTFB on /_root.data (observed on a warm machine ~10min after a deploy, i.e. a
// STALE cache being synchronously refreshed). Behavior:
//   - fresh cache → serve it
//   - stale cache → serve stale NOW, refresh in the background (never block)
//   - cold cache  → block on the fetch (bounded by FETCH_TIMEOUT_MS). Rare:
//                   warmGeneralCalendarFeed() primes this at server startup, so
//                   users don't hit the cold path after a deploy/restart.
async function getFeed(url: string): Promise<RawEvent[] | null> {
  const cached = feedCache?.url === url ? feedCache : null;
  if (cached) {
    if (Date.now() - cached.fetchedAt >= CACHE_TTL_MS) {
      // Stale: kick a background refresh but serve the stale copy immediately.
      void refreshFeed(url);
    }
    return cached.events;
  }
  // Cold: nothing cached yet — must wait once.
  return refreshFeed(url);
}

// Populate the feed cache off the request path (called at server startup and
// safe to call from a background job). Awaits the fetch — that's fine here
// because no user request is waiting on it.
export async function warmGeneralCalendarFeed(): Promise<void> {
  const url = process.env.DALI_GENERAL_CALENDAR_ICS;
  if (!url) return;
  await refreshFeed(url);
}

// Fetch + parse the feed, returning events that overlap [windowStart, windowEnd].
// Returns [] (never throws) when unconfigured or on any fetch/parse error — the
// home panel degrades to an empty grid + hint rather than failing the page.
export async function fetchGeneralCalendarEvents(
  windowStart: Date,
  windowEnd: Date,
): Promise<GeneralCalendarEvent[]> {
  const url = process.env.DALI_GENERAL_CALENDAR_ICS;
  if (!url) return [];

  const raw = await getFeed(url);
  if (!raw) return [];

  const out: GeneralCalendarEvent[] = [];
  for (const ev of raw) {
    if (!ev.rrule) {
      // One-off: include if it overlaps the window.
      if (ev.end.getTime() > windowStart.getTime() && ev.start.getTime() < windowEnd.getTime()) {
        out.push({ ...meta(ev), start: ev.start, end: ev.end });
      }
      continue;
    }
    // Recurring: expand occurrences whose start falls in the window. Each
    // occurrence keeps the original event's duration.
    const rule = buildRule(ev.rrule, ev.start);
    if (!rule) continue;
    const durMs = Math.max(0, ev.end.getTime() - ev.start.getTime());
    // Pad the lower bound by the duration so an occurrence that starts just
    // before the window but overlaps into it is still caught.
    const occurrences = rule.between(new Date(windowStart.getTime() - durMs), windowEnd, true);
    for (const occStart of occurrences) {
      out.push({
        ...meta(ev),
        start: occStart,
        end: new Date(occStart.getTime() + durMs),
        summary: ev.summary,
        allDay: ev.allDay,
      });
    }
  }
  return out;
}

// The non-time fields every occurrence of an event shares. Recurrences differ
// only in start/end, so this keeps the two push sites from drifting.
function meta(ev: RawEvent): Omit<GeneralCalendarEvent, "start" | "end"> {
  return {
    summary: ev.summary,
    allDay: ev.allDay,
    location: ev.location,
    description: ev.description,
    organizer: ev.organizer,
    url: ev.url,
  };
}

// Build an RRule anchored at the event's DTSTART, matching ~/lib/availability's
// idiom. Returns null on a malformed rule or an RRuleSet (not needed here).
function buildRule(rule: string, dtstart: Date): RRuleType | null {
  try {
    const trimmed = rule.trim();
    const rrulePart = trimmed.toUpperCase().startsWith("RRULE:") ? trimmed : `RRULE:${trimmed}`;
    const pad = (n: number) => String(n).padStart(2, "0");
    const dt =
      `${dtstart.getUTCFullYear()}${pad(dtstart.getUTCMonth() + 1)}${pad(dtstart.getUTCDate())}` +
      `T${pad(dtstart.getUTCHours())}${pad(dtstart.getUTCMinutes())}${pad(dtstart.getUTCSeconds())}Z`;
    const parsed = rrulestr(`DTSTART:${dt}\n${rrulePart}`);
    return parsed instanceof RRule ? parsed : null;
  } catch {
    return null;
  }
}

// ─── minimal iCal parsing ────────────────────────────────────────────────────

// Unfold folded lines: per RFC 5545, a line continuation starts with a space or
// tab and joins to the previous line.
function unfold(raw: string): string[] {
  const physical = raw.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseIcs(raw: string): RawEvent[] {
  const lines = unfold(raw);
  const out: RawEvent[] = [];
  let cur:
    | {
        start?: Date;
        end?: Date;
        summary?: string;
        allDay?: boolean;
        rrule?: string;
        location?: string;
        description?: string;
        organizer?: string;
        url?: string;
      }
    | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.start && cur.summary) {
        const start = cur.start;
        // All-day events have no DTEND time; default to a 1-hour block so they
        // render in the grid without spanning the whole day.
        const end = cur.end ?? new Date(start.getTime() + 60 * 60_000);
        out.push({
          start,
          end,
          summary: cur.summary,
          allDay: cur.allDay ?? false,
          rrule: cur.rrule ?? null,
          location: cur.location ?? null,
          description: cur.description ?? null,
          organizer: cur.organizer ?? null,
          url: cur.url ?? null,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const namePart = line.slice(0, colon); // e.g. "DTSTART;TZID=America/New_York"
    const value = line.slice(colon + 1);
    const name = namePart.split(";")[0];

    if (name === "SUMMARY") {
      cur.summary = unescapeText(value);
    } else if (name === "DTSTART") {
      const parsed = parseIcsDate(namePart, value);
      if (parsed) {
        cur.start = parsed.date;
        cur.allDay = parsed.allDay;
      }
    } else if (name === "DTEND") {
      const parsed = parseIcsDate(namePart, value);
      if (parsed) cur.end = parsed.date;
    } else if (name === "RRULE") {
      cur.rrule = value;
    } else if (name === "LOCATION") {
      cur.location = unescapeText(value) || undefined;
    } else if (name === "DESCRIPTION") {
      cur.description = unescapeText(value) || undefined;
    } else if (name === "ORGANIZER") {
      // ORGANIZER is a mailto: URI, often with a CN= param on the name part.
      const cn = /CN=([^;:]+)/.exec(namePart);
      cur.organizer = (cn?.[1] ?? value.replace(/^mailto:/i, "")).trim() || undefined;
    } else if (name === "URL") {
      cur.url = value.trim() || undefined;
    }
  }
  return out;
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

// Parse a DTSTART/DTEND value. Handles three forms:
//   • UTC:        20260524T140000Z
//   • date-only:  VALUE=DATE → 20260524           (all-day)
//   • TZID/local: 20260524T140000  (interpreted in the named tz, or local)
// Google's public feeds emit UTC (`Z`) for timed events, which is the common
// case; we resolve TZID via Intl so other producers work too.
function parseIcsDate(namePart: string, value: string): { date: Date; allDay: boolean } | null {
  // Date-only (all-day): YYYYMMDD
  if (/^\d{8}$/.test(value)) {
    const y = +value.slice(0, 4);
    const m = +value.slice(4, 6);
    const d = +value.slice(6, 8);
    return { date: new Date(Date.UTC(y, m - 1, d)), allDay: true };
  }

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) return null;
  const [, ys, mo, da, hh, mm, ss, z] = m;
  const y = +ys;
  const mon = +mo;
  const day = +da;
  const hour = +hh;
  const min = +mm;
  const sec = +ss;

  if (z === "Z") {
    return { date: new Date(Date.UTC(y, mon - 1, day, hour, min, sec)), allDay: false };
  }

  // Floating or TZID local time. Resolve the named zone's UTC offset at that
  // wall-clock instant; fall back to UTC if the tz is missing/invalid.
  const tzid = /TZID=([^;:]+)/.exec(namePart)?.[1];
  if (!tzid) {
    return { date: new Date(Date.UTC(y, mon - 1, day, hour, min, sec)), allDay: false };
  }
  try {
    // zonedWallTimeUtc handles minute-precision wall clocks; carry seconds
    // separately since DST offsets never change mid-minute.
    const minuteUtc = zonedWallTimeUtc(y, mon, day, hour, min, tzid);
    return { date: new Date(minuteUtc.getTime() + sec * 1000), allDay: false };
  } catch {
    return { date: new Date(Date.UTC(y, mon - 1, day, hour, min, sec)), allDay: false };
  }
}
