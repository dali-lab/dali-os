import DOMPurify from "isomorphic-dompurify";
import { prisma } from "~/lib/db";
import { decrypt, encrypt } from "~/lib/calendar-crypto";
import { GoogleOAuthError, refreshGoogleToken } from "~/lib/google-oauth";
import { APPLICATION_TZ } from "~/lib/timezone";

interface BusyEvent {
  start: string; // ISO
  end: string; // ISO
  // Enriched from events.list so the calendar can show the real event name and
  // colour it by source calendar. All optional: availability math only reads
  // start/end, and a busy block with no title still renders as "Busy".
  title?: string;
  calendarId?: string; // the Google sub-calendar this event came from
  color?: string; // that calendar's backgroundColor (hex), for per-calendar tint
  description?: string;
  location?: string;
  // Detail-popover extras, straight from events.list. Availability renders
  // these when a block is clicked; availability math never reads them.
  attendees?: EventAttendee[];
  /** The event's own page on Google Calendar. */
  htmlLink?: string;
  /** Google Meet (or other conferencing) join URL, when the event has one. */
  meetingUrl?: string;
  organizerName?: string;
}

/** One invitee on an external event, as shown in the detail popover. */
export interface EventAttendee {
  /** displayName when Google has one, else the email. */
  name: string;
  email?: string;
  responseStatus: "accepted" | "declined" | "tentative" | "needsAction";
  organizer?: boolean;
  self?: boolean;
  optional?: boolean;
}

// Bound the payload: a 300-person all-hands shouldn't ship 300 rows to the
// client for a popover that lists the first handful.
const MAX_ATTENDEES = 50;

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null; // ISO
}

interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  /** "owner" | "writer" | "reader" | "freeBusyReader" — from calendarList API */
  accessRole?: string;
}

const REFRESH_BUFFER_MS = 60_000;

// ─── Token management ──────────────────────────────────────────────────────

function parseStoredTokens(cipher: string): StoredTokens {
  const raw = decrypt(cipher);
  const parsed = JSON.parse(raw) as StoredTokens;
  if (typeof parsed.refreshToken !== "string") {
    throw new Error("UserCalendarLink oauthTokens missing refreshToken");
  }
  return parsed;
}

function serializeStoredTokens(t: StoredTokens): string {
  return encrypt(JSON.stringify(t));
}

async function refreshAndPersist(linkId: string, refreshToken: string): Promise<string> {
  let data;
  try {
    data = await refreshGoogleToken({
      refreshToken,
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    });
  } catch (err) {
    if (err instanceof GoogleOAuthError) {
      throw new Error(`Google token refresh failed (${err.upstreamStatus ?? "?"})`);
    }
    throw err;
  }
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  const stored: StoredTokens = {
    accessToken: data.access_token,
    refreshToken,
    expiresAt,
  };
  await prisma.userCalendarLink.update({
    where: { id: linkId },
    data: { oauthTokens: serializeStoredTokens(stored) },
  });
  return data.access_token;
}

export async function getValidAccessTokenForLink(linkId: string): Promise<string> {
  const link = await prisma.userCalendarLink.findUnique({
    where: { id: linkId },
    select: { oauthTokens: true },
  });
  if (!link) throw new Error(`UserCalendarLink ${linkId} not found`);
  const t = parseStoredTokens(link.oauthTokens);
  if (t.expiresAt && new Date(t.expiresAt).getTime() > Date.now() + REFRESH_BUFFER_MS) {
    return t.accessToken;
  }
  return refreshAndPersist(linkId, t.refreshToken);
}


// Convenience for the OAuth callback that has just received tokens from Google.
export function buildEncryptedTokens(opts: {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number | null;
}): string {
  return serializeStoredTokens({
    accessToken: opts.accessToken,
    refreshToken: opts.refreshToken,
    expiresAt: opts.expiresInSec ? new Date(Date.now() + opts.expiresInSec * 1000).toISOString() : null,
  });
}

// ─── API calls ─────────────────────────────────────────────────────────────

// `prefetchedToken` lets callers that already hold a valid token skip the DB
// read that `getValidAccessTokenForLink` would otherwise perform.
export async function listCalendarsForLink(
  linkId: string,
  prefetchedToken?: string,
): Promise<GoogleCalendarListEntry[]> {
  const token = prefetchedToken ?? await getValidAccessTokenForLink(linkId);
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google calendarList failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { items?: GoogleCalendarListEntry[] };
  return data.items ?? [];
}

// Subscribe a linked account to an existing calendar it doesn't own (adds the
// calendar to that Google account's calendar list). Google answers 409 when it
// is already there, which is the same end state the caller wants.
export async function subscribeCalendarForLink(
  linkId: string,
  calendarId: string,
): Promise<void> {
  const token = await getValidAccessTokenForLink(linkId);
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: calendarId }),
  });
  if (!res.ok && res.status !== 409) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google calendarList insert failed (${res.status}): ${detail}`);
  }
}

async function extractGoogleErrorDetail(res: Response): Promise<string> {
  try {
    const data = (await res.clone().json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const msg = data.error?.message;
    const reason = data.error?.errors?.[0]?.reason;
    if (msg && reason) return `${reason}: ${msg}`;
    if (msg) return msg;
    if (reason) return reason;
  } catch {
    // fall through to text
  }
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "no detail";
  }
}

interface GoogleEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  transparency?: string; // "opaque" (busy) | "transparent" (free)
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: {
    email?: string;
    displayName?: string;
    self?: boolean;
    organizer?: boolean;
    optional?: boolean;
    responseStatus?: string;
  }[];
}

const RESPONSE_STATUSES = ["accepted", "declined", "tentative", "needsAction"] as const;

function attendeeResponse(raw: string | undefined): EventAttendee["responseStatus"] {
  return (RESPONSE_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as EventAttendee["responseStatus"])
    : "needsAction";
}

// Google only fills hangoutLink for Meet; conferenceData covers Zoom/Teams
// add-ons too, so fall through to the first video entry point.
function conferenceUrl(ev: GoogleEvent): string | undefined {
  if (ev.hangoutLink) return ev.hangoutLink;
  const video = ev.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video");
  return video?.uri;
}

/**
 * Google descriptions are often HTML; flatten to plain text for display.
 *
 * DOMPurify (a real HTML parser, not string regex) does the actual
 * sanitization — restricted to just the tags we turn into newlines — so a
 * real `<script>` tag, however it's encoded in the source, can't survive.
 * Deliberately does NOT decode `&lt;`/`&gt;` afterward: those are the only
 * two entities that can reconstruct an angle bracket, and DOMPurify safely
 * leaves an inert, escaped `&lt;script&gt;` in the source exactly as such —
 * decoding it back to `<script>` here would hand the vulnerability right
 * back (this is what CodeQL flagged: the output must never contain a literal
 * "<script", not just avoid parsing as one). Everything else DOMPurify is
 * already used for elsewhere too (~/lib/email.ts).
 */
function plainTextFromGoogleHtml(html: string): string {
  // ALLOWED_TAGS + ALLOWED_ATTR: [] means DOMPurify's output can only ever
  // contain the bare strings <p>, </p>, <br>, <br/> as markup — nothing else
  // survives sanitization. So the three replacements below are each an exact,
  // bounded substring match, not a generic "<...>" wildcard sweep (CodeQL's
  // incomplete-sanitization query specifically distrusts that broader shape,
  // regardless of what ran before it — it doesn't credit DOMPurify's pass).
  const safe = DOMPurify.sanitize(html, { ALLOWED_TAGS: ["p", "br"], ALLOWED_ATTR: [] });
  return safe
    .replace(/<br\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// One sub-calendar's confirmed, time-bounded, not-declined, busy events in the
// window. Uses events.list (not freeBusy) so we get the real title; freeBusy
// returns only opaque time ranges. `color` is the calendar's backgroundColor,
// threaded onto every event so the grid can tint by source calendar.
async function fetchEventsForCalendar(
  token: string,
  calendarId: string,
  color: string | undefined,
  start: Date,
  end: Date,
): Promise<BusyEvent[]> {
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true", // expand recurring events into instances
    orderBy: "startTime",
    maxResults: "250",
    fields:
      "items(id,summary,description,location,status,transparency,start,end," +
      "htmlLink,hangoutLink,conferenceData(entryPoints(entryPointType,uri))," +
      "organizer(email,displayName,self)," +
      "attendees(email,displayName,self,organizer,optional,responseStatus))",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google events.list failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { items?: GoogleEvent[] };
  const out: BusyEvent[] = [];
  for (const ev of data.items ?? []) {
    // Skip cancelled, all-day (date-only, no dateTime), free/transparent, and
    // events this user has declined — matching the old "busy" semantics.
    if (ev.status === "cancelled") continue;
    if (ev.transparency === "transparent") continue;
    const startIso = ev.start?.dateTime;
    const endIso = ev.end?.dateTime;
    if (!startIso || !endIso) continue;
    const self = ev.attendees?.find((a) => a.self);
    if (self?.responseStatus === "declined") continue;
    out.push({
      start: startIso,
      end: endIso,
      title: ev.summary?.trim() || "Busy",
      calendarId,
      color,
      description: ev.description ? plainTextFromGoogleHtml(ev.description) : undefined,
      location: ev.location?.trim() || undefined,
      attendees: ev.attendees?.slice(0, MAX_ATTENDEES).map((a) => ({
        name: a.displayName?.trim() || a.email || "Guest",
        email: a.email,
        responseStatus: attendeeResponse(a.responseStatus),
        organizer: a.organizer,
        self: a.self,
        optional: a.optional,
      })),
      htmlLink: ev.htmlLink,
      meetingUrl: conferenceUrl(ev),
      organizerName: ev.organizer?.displayName?.trim() || ev.organizer?.email || undefined,
    });
  }
  return out;
}

// `prefetchedToken` and `prefetchedColorById` let callers that already hold
// those values skip the extra DB read + HTTP round-trip that this function
// would otherwise make. When either is omitted the function falls back to
// fetching it itself (preserving backward-compatible behavior for call sites
// that don't have them).
async function fetchBusyForLink(
  linkId: string,
  subCalendarIds: string[],
  start: Date,
  end: Date,
  prefetchedToken?: string,
  prefetchedColorById?: Map<string, string | undefined>,
): Promise<BusyEvent[]> {
  const token = prefetchedToken ?? await getValidAccessTokenForLink(linkId);
  // Map calendarId → backgroundColor so each event can be tinted by its source.
  let colorById: Map<string, string | undefined>;
  if (prefetchedColorById) {
    colorById = prefetchedColorById;
  } else {
    colorById = new Map<string, string | undefined>();
    try {
      const list = await listCalendarsForLink(linkId, token);
      colorById = new Map(list.map((c) => [c.id, c.backgroundColor]));
    } catch {
      // Colour is best-effort; events still render (untinted) without it.
    }
  }
  const calendarIds = subCalendarIds.length > 0 ? subCalendarIds : ["primary"];
  const perCalendar = await Promise.all(
    calendarIds.map((id) =>
      fetchEventsForCalendar(token, id, colorById.get(id), start, end),
    ),
  );
  return perCalendar.flat();
}

/**
 * Fetch busy events for a user across all enabled Google calendar links.
 * Phase 2: the legacy fallback (`fetchBusyFromLegacyUserTokens`) was removed
 * alongside the drop of `User.google*` columns. Users without a
 * UserCalendarLink return an empty array — the calling UI should prompt
 * them to link a calendar in Settings.
 *
 * Perf: callers can pass pre-fetched per-link data to avoid duplicate work:
 * - `prefetchedTokens`: Map<linkId, accessToken> — skips the DB token read.
 * - `prefetchedCalendarLists`: Map<linkId, items[]> — skips the calendarList
 *   HTTP call used to build the per-event color map.
 *
 * When both are supplied the function performs zero redundant DB reads or
 * Google API calls beyond the events.list calls themselves.
 */
export async function fetchBusyEvents(
  userId: string,
  start: Date,
  end: Date,
  prefetchedCalendarLists?: Map<string, GoogleCalendarListEntry[] | undefined>,
  prefetchedTokens?: Map<string, string>,
): Promise<BusyEvent[]> {
  const links = await prisma.userCalendarLink.findMany({
    where: { userId, provider: "Google", enabled: true },
    select: { id: true, subCalendarIds: true },
  });
  if (links.length === 0) return [];
  const results = await Promise.all(
    links.map(async (l) => {
      try {
        // Use a pre-fetched token if the caller already holds one for this
        // link; otherwise fetch it (one DB read + optional refresh).
        const token = prefetchedTokens?.get(l.id) ?? await getValidAccessTokenForLink(l.id);

        // Build the color map: prefer a pre-fetched list from the caller,
        // then fall back to fetching ourselves (best-effort; untinted on fail).
        let colorById = new Map<string, string | undefined>();
        const prefetchedList = prefetchedCalendarLists?.get(l.id);
        if (prefetchedList) {
          colorById = new Map(prefetchedList.map((c) => [c.id, c.backgroundColor]));
        } else {
          try {
            const list = await listCalendarsForLink(l.id, token);
            colorById = new Map(list.map((c) => [c.id, c.backgroundColor]));
          } catch {
            // Colour is best-effort; events still render (untinted).
          }
        }

        const events = await fetchBusyForLink(
          l.id,
          l.subCalendarIds,
          start,
          end,
          token,
          colorById,
        );
        await prisma.userCalendarLink.update({
          where: { id: l.id },
          data: { lastSyncedAt: new Date(), syncError: null },
        });
        return events;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        await prisma.userCalendarLink
          .update({ where: { id: l.id }, data: { syncError: message } })
          .catch(() => {});
        return [];
      }
    }),
  );
  return results.flat();
}

// ─── Full-calendar read ─────────────────────────────────────────────────────

/**
 * A single Google Calendar event normalised for the full calendar UI.
 * Unlike BusyEvent (busy-only, no all-day, declines filtered), CalendarEvent
 * carries every event the viewer can see: all-day, free, tentative, declined.
 */
export interface CalendarEvent {
  eventId: string;
  calendarId: string;
  linkId: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  title: string;
  description?: string;
  location?: string;
  attendees?: EventAttendee[];
  organizerName?: string;
  htmlLink?: string;
  meetingUrl?: string;
  recurringEventId?: string;
  /** The calendar's backgroundColor hex, for per-calendar tinting. */
  color?: string;
  /** True when the viewer's access role for this calendar is owner or writer. */
  writable: boolean;
  /** The viewer's own RSVP (self attendee); undefined when not an attendee. */
  responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
}

// Fetches ALL events for one sub-calendar in the window — all-day, free,
// tentative, and declined are all included (only cancelled is skipped).
// Does NOT reuse fetchEventsForCalendar, which enforces busy-only semantics.
async function fetchAllEventsForCalendar(
  token: string,
  calendarId: string,
  linkId: string,
  calendarMeta: GoogleCalendarListEntry | undefined,
  start: Date,
  end: Date,
  // Free-text query — when set, Google filters events server-side (summary,
  // description, location, attendees). Used by searchCalendarEvents.
  q?: string,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    fields:
      "items(id,recurringEventId,summary,description,location,status,transparency," +
      "start(dateTime,date),end(dateTime,date)," +
      "htmlLink,hangoutLink,conferenceData(entryPoints(entryPointType,uri))," +
      "organizer(email,displayName,self)," +
      "attendees(email,displayName,self,organizer,optional,responseStatus))",
  });
  if (q && q.trim()) params.set("q", q.trim());
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google events.list failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { items?: (GoogleEvent & { recurringEventId?: string })[] };
  const color = calendarMeta?.backgroundColor;
  const writable =
    calendarMeta?.accessRole === "owner" || calendarMeta?.accessRole === "writer";
  const out: CalendarEvent[] = [];
  for (const ev of data.items ?? []) {
    if (ev.status === "cancelled") continue;
    const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
    let startIso: string;
    let endIso: string;
    if (allDay) {
      // Use UTC midnight so the grid can treat these as full-day spans without
      // timezone shifting.
      startIso = new Date(ev.start!.date! + "T00:00:00.000Z").toISOString();
      endIso = new Date(ev.end!.date! + "T00:00:00.000Z").toISOString();
    } else {
      if (!ev.start?.dateTime || !ev.end?.dateTime) continue;
      startIso = ev.start.dateTime;
      endIso = ev.end.dateTime;
    }
    const selfAttendee = ev.attendees?.find((a) => a.self);
    const responseStatus = selfAttendee
      ? attendeeResponse(selfAttendee.responseStatus)
      : undefined;
    out.push({
      eventId: ev.id ?? "",
      calendarId,
      linkId,
      startIso,
      endIso,
      allDay,
      title: ev.summary?.trim() || "(No title)",
      description: ev.description ? plainTextFromGoogleHtml(ev.description) : undefined,
      location: ev.location?.trim() || undefined,
      attendees: ev.attendees?.slice(0, MAX_ATTENDEES).map((a) => ({
        name: a.displayName?.trim() || a.email || "Guest",
        email: a.email,
        responseStatus: attendeeResponse(a.responseStatus),
        organizer: a.organizer,
        self: a.self,
        optional: a.optional,
      })),
      organizerName: ev.organizer?.displayName?.trim() || ev.organizer?.email || undefined,
      htmlLink: ev.htmlLink,
      meetingUrl: conferenceUrl(ev),
      recurringEventId: (ev as { recurringEventId?: string }).recurringEventId,
      color,
      writable,
      responseStatus,
    });
  }
  return out;
}

/**
 * Fetch ALL Google Calendar events for a user across all enabled links.
 * Returns every event the viewer can see (all-day, free, tentative, declined);
 * only cancelled events are omitted.
 *
 * Structured like `fetchBusyEvents` — callers may pass pre-fetched tokens and
 * calendar lists to avoid redundant round-trips:
 * - `prefetchedTokens`: Map<linkId, accessToken>
 * - `prefetchedCalendarLists`: Map<linkId, GoogleCalendarListEntry[]>
 *
 * One bad link throws to its own catch block and returns [] for that link, so
 * the rest of the calendar still loads.
 */
export async function fetchCalendarEvents(
  userId: string,
  start: Date,
  end: Date,
  prefetchedCalendarLists?: Map<string, GoogleCalendarListEntry[] | undefined>,
  prefetchedTokens?: Map<string, string>,
): Promise<CalendarEvent[]> {
  const links = await prisma.userCalendarLink.findMany({
    where: { userId, provider: "Google", enabled: true },
    select: { id: true, subCalendarIds: true },
  });
  if (links.length === 0) return [];
  const results = await Promise.all(
    links.map(async (l) => {
      try {
        const token = prefetchedTokens?.get(l.id) ?? await getValidAccessTokenForLink(l.id);

        // Build a map of calendarId → entry (has both backgroundColor + accessRole).
        let entryById = new Map<string, GoogleCalendarListEntry>();
        const prefetchedList = prefetchedCalendarLists?.get(l.id);
        if (prefetchedList) {
          entryById = new Map(prefetchedList.map((c) => [c.id, c]));
        } else {
          try {
            const list = await listCalendarsForLink(l.id, token);
            entryById = new Map(list.map((c) => [c.id, c]));
          } catch {
            // Best-effort; events still load without color/writable metadata.
          }
        }

        const calendarIds = l.subCalendarIds.length > 0 ? l.subCalendarIds : ["primary"];
        const perCalendar = await Promise.all(
          calendarIds.map((id) =>
            fetchAllEventsForCalendar(token, id, l.id, entryById.get(id), start, end),
          ),
        );
        await prisma.userCalendarLink.update({
          where: { id: l.id },
          data: { lastSyncedAt: new Date(), syncError: null },
        });
        return perCalendar.flat();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        await prisma.userCalendarLink
          .update({ where: { id: l.id }, data: { syncError: message } })
          .catch(() => {});
        return [] as CalendarEvent[];
      }
    }),
  );
  return results.flat();
}

/**
 * Free-text search across a user's enabled Google calendars, bounded to a time
 * window. Google filters server-side via the `q` param (summary, description,
 * location, attendees), so this is one events.list call per sub-calendar — cheap
 * enough to run on demand from the calendar search bar. Unlike the loader reads
 * it does NOT touch lastSyncedAt/syncError (search is read-only), and a bad link
 * is swallowed so the rest of the results still return.
 */
export async function searchCalendarEvents(
  userId: string,
  q: string,
  start: Date,
  end: Date,
): Promise<CalendarEvent[]> {
  if (!q.trim()) return [];
  const links = await prisma.userCalendarLink.findMany({
    where: { userId, provider: "Google", enabled: true },
    select: { id: true, subCalendarIds: true },
  });
  if (links.length === 0) return [];
  const results = await Promise.all(
    links.map(async (l) => {
      try {
        const token = await getValidAccessTokenForLink(l.id);
        let entryById = new Map<string, GoogleCalendarListEntry>();
        try {
          const list = await listCalendarsForLink(l.id, token);
          entryById = new Map(list.map((c) => [c.id, c]));
        } catch {
          // Best-effort colour/writable metadata; matches still return.
        }
        const calendarIds = l.subCalendarIds.length > 0 ? l.subCalendarIds : ["primary"];
        const perCalendar = await Promise.all(
          calendarIds.map((id) =>
            fetchAllEventsForCalendar(token, id, l.id, entryById.get(id), start, end, q),
          ),
        );
        return perCalendar.flat();
      } catch {
        return [] as CalendarEvent[];
      }
    }),
  );
  return results.flat();
}

// ─── events.insert / events.patch ──────────────────────────────────────────

export type GoogleAttendee = {
  email: string;
  displayName?: string;
};

export type CreateGoogleEventInput = {
  linkId: string;
  summary: string;
  description?: string;
  location?: string;
  startIso: string;
  endIso: string;
  // RFC 5545 RRULE; pass without the "RRULE:" prefix (e.g. "FREQ=WEEKLY;BYDAY=MO").
  recurrenceRule?: string | null;
  // IANA zone the RRULE expands in. Google rejects a recurring insert that
  // carries no zone ("Missing time zone definition for start time") even when
  // startIso already has a UTC offset. Defaults to the lab zone.
  timeZone?: string;
  attendees: GoogleAttendee[];
  // Sub-calendar id to write into. Defaults to "primary".
  calendarId?: string;
  // All-day event: startIso/endIso are read as dates (YYYY-MM-DD portion); end
  // is Google-exclusive, so pass the day AFTER the last day.
  allDay?: boolean;
  // Mint a Google Meet conference on the event. Sets conferenceDataVersion=1 and
  // a createRequest so Google generates a hangoutsMeet link; the returned
  // `meetUrl` carries the join URL.
  addMeet?: boolean;
  // Who Google emails about the event. "all" (default) lets Google send the
  // Gmail invite on our behalf; "none" suppresses it — used when the caller
  // owns invite delivery itself (interviews send their own templated emails and
  // create the event only to host the Meet link).
  sendUpdates?: "all" | "none";
};

export async function createGoogleCalendarEvent(
  input: CreateGoogleEventInput,
): Promise<{ eventId: string; htmlLink: string | null; meetUrl: string | null }> {
  const token = await getValidAccessTokenForLink(input.linkId);
  const calendarId = encodeURIComponent(input.calendarId ?? "primary");
  const timeZone = input.timeZone ?? APPLICATION_TZ;
  const body: Record<string, unknown> = {
    summary: input.summary,
    start: input.allDay
      ? { date: input.startIso.slice(0, 10) }
      : { dateTime: input.startIso, timeZone },
    end: input.allDay
      ? { date: input.endIso.slice(0, 10) }
      : { dateTime: input.endIso, timeZone },
  };
  if (input.description) body.description = input.description;
  if (input.location) body.location = input.location;
  if (input.recurrenceRule) {
    const rule = input.recurrenceRule.startsWith("RRULE:")
      ? input.recurrenceRule
      : `RRULE:${input.recurrenceRule}`;
    body.recurrence = [rule];
  }
  if (input.attendees.length > 0) body.attendees = input.attendees;
  if (input.addMeet) {
    body.conferenceData = {
      createRequest: {
        // Unique per request; a reused id returns the same conference, so a
        // random suffix keeps every insert minting a fresh Meet link.
        requestId: `dali-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  // sendUpdates=all → Google sends Gmail invites to all attendees on our behalf.
  const params = new URLSearchParams({ sendUpdates: input.sendUpdates ?? "all" });
  if (input.addMeet) params.set("conferenceDataVersion", "1");
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params.toString()}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google events.insert failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as GoogleEvent;
  if (!data.id) throw new Error("Google events.insert returned no event id");
  let meetUrl: string | null = null;
  if (input.addMeet) {
    // Conference creation is async: the insert can return before Google has
    // populated the link (createRequest.status "pending"). Take it from the
    // insert response when present, else re-read the event once.
    meetUrl =
      conferenceUrl(data) ??
      (await fetchEventMeetUrl(token, calendarId, data.id).catch(() => null));
  }
  return { eventId: data.id, htmlLink: data.htmlLink ?? null, meetUrl };
}

/** Re-read a just-created event's Meet link. Called when events.insert returned
 *  before the conference was minted (status "pending"). Best-effort: any failure
 *  resolves to null and the link is picked up later on the calendar read path. */
async function fetchEventMeetUrl(
  token: string,
  encodedCalendarId: string,
  eventId: string,
): Promise<string | null> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events/${encodeURIComponent(eventId)}` +
      `?fields=hangoutLink,conferenceData(entryPoints(entryPointType,uri))`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  return conferenceUrl((await res.json()) as GoogleEvent) ?? null;
}

/** Edit an event we created (a class's time / title / recurrence changed). Only
 *  the passed fields are patched; recurrenceRule:null clears the recurrence. */
export async function patchGoogleCalendarEvent(input: {
  linkId: string;
  calendarId?: string;
  eventId: string;
  summary?: string;
  description?: string;
  location?: string;
  startIso?: string;
  endIso?: string;
  allDay?: boolean;
  recurrenceRule?: string | null;
  timeZone?: string;
  // Replace the guest list (interviews re-sync attendees on reassignment so the
  // new interviewer is a recognized guest on the Meet event).
  attendees?: GoogleAttendee[];
  // Defaults to Google's own default for patch (no notifications). Pass "all"
  // to have Google email guests about the change.
  sendUpdates?: "all" | "none";
}): Promise<void> {
  const token = await getValidAccessTokenForLink(input.linkId);
  const calendarId = encodeURIComponent(input.calendarId ?? "primary");
  const timeZone = input.timeZone ?? APPLICATION_TZ;
  const body: Record<string, unknown> = {};
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description;
  if (input.location !== undefined) body.location = input.location;
  if (input.startIso) body.start = input.allDay ? { date: input.startIso.slice(0, 10) } : { dateTime: input.startIso, timeZone };
  if (input.endIso) body.end = input.allDay ? { date: input.endIso.slice(0, 10) } : { dateTime: input.endIso, timeZone };
  if (input.attendees !== undefined) body.attendees = input.attendees;
  if (input.recurrenceRule !== undefined) {
    body.recurrence = input.recurrenceRule
      ? [input.recurrenceRule.startsWith("RRULE:") ? input.recurrenceRule : `RRULE:${input.recurrenceRule}`]
      : [];
  }
  const patchUrl =
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(input.eventId)}` +
    (input.sendUpdates ? `?sendUpdates=${input.sendUpdates}` : "");
  const res = await fetch(
    patchUrl,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google events.patch failed (${res.status}): ${detail}`);
  }
}

/** Delete an event we created. A 404/410 (already gone) counts as success — the
 *  caller's goal is that the event no longer exists. */
export async function deleteGoogleCalendarEvent(opts: {
  linkId: string;
  calendarId?: string;
  eventId: string;
}): Promise<void> {
  const token = await getValidAccessTokenForLink(opts.linkId);
  const calendarId = encodeURIComponent(opts.calendarId ?? "primary");
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(opts.eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google events.delete failed (${res.status}): ${detail}`);
  }
}

/** Find (by summary) or create a dedicated calendar on the linked account and
 *  return its id. Backs the "dedicated Classes calendar" destination so class
 *  events group cleanly and toggle/remove without touching the primary. */
export async function getOrCreateNamedCalendar(linkId: string, summary: string): Promise<string> {
  const token = await getValidAccessTokenForLink(linkId);
  const wanted = summary.trim().toLowerCase();
  const existing = (await listCalendarsForLink(linkId, token)).find(
    (c) => c.summary?.trim().toLowerCase() === wanted,
  );
  if (existing) return existing.id;
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary }),
  });
  if (!res.ok) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google calendars.insert failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("Google calendars.insert returned no id");
  return data.id;
}

// ─── Calendar management ───────────────────────────────────────────────────

/** Always create a new Google Calendar (does not check for an existing one by
 *  name — use `getOrCreateNamedCalendar` for find-or-create behaviour).
 *  Returns the new calendar's id. */
export async function createCalendar(linkId: string, summary: string): Promise<string> {
  const token = await getValidAccessTokenForLink(linkId);
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary }),
  });
  if (!res.ok) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google calendars.insert failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("Google calendars.insert returned no id");
  return data.id;
}

/** Rename and/or recolor a calendar the user owns.
 *  - `summary` patches the underlying calendar resource (visible to all users of that calendar).
 *  - `color` (hex, e.g. "#d50000") patches the per-user calendarList entry so the color shows
 *    only for this linked account. Requires colorRgbFormat=true per the Google API. */
export async function patchCalendar(opts: {
  linkId: string;
  calendarId: string;
  summary?: string;
  color?: string;
}): Promise<void> {
  const token = await getValidAccessTokenForLink(opts.linkId);
  const encodedId = encodeURIComponent(opts.calendarId);

  if (opts.summary !== undefined) {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodedId}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ summary: opts.summary }),
      },
    );
    if (!res.ok) {
      const detail = await extractGoogleErrorDetail(res);
      throw new Error(`Google calendars.patch failed (${res.status}): ${detail}`);
    }
  }

  if (opts.color !== undefined) {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodedId}?colorRgbFormat=true`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ backgroundColor: opts.color, foregroundColor: "#000000" }),
      },
    );
    if (!res.ok) {
      const detail = await extractGoogleErrorDetail(res);
      throw new Error(`Google calendarList.patch (color) failed (${res.status}): ${detail}`);
    }
  }
}

/** Delete a Google Calendar the user owns. 404/410 (already gone) are treated
 *  as success. Throws before calling Google if calendarId is "primary" — the
 *  primary calendar cannot be deleted. */
export async function deleteCalendar(linkId: string, calendarId: string): Promise<void> {
  if (calendarId === "primary") {
    throw new Error("Can't delete your primary calendar");
  }
  const token = await getValidAccessTokenForLink(linkId);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google calendars.delete failed (${res.status}): ${detail}`);
  }
}

/** Fetch a single Google Calendar event — primarily used to read a recurring
 *  master event's RRULE when splitting a series. Returns only the fields needed
 *  for that use-case (recurrence, start dateTime/date). */
export async function getGoogleEvent(opts: {
  linkId: string;
  calendarId?: string;
  eventId: string;
}): Promise<{ id: string; recurrence: string[]; startIso: string | null; startDate: string | null }> {
  const token = await getValidAccessTokenForLink(opts.linkId);
  const calendarId = encodeURIComponent(opts.calendarId ?? "primary");
  const params = new URLSearchParams({ fields: "id,recurrence,start(dateTime,date)" });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(opts.eventId)}?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google events.get failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as {
    id?: string;
    recurrence?: string[];
    start?: { dateTime?: string; date?: string };
  };
  return {
    id: data.id ?? opts.eventId,
    recurrence: data.recurrence ?? [],
    startIso: data.start?.dateTime ?? null,
    startDate: data.start?.date ?? null,
  };
}

// ─── RSVP ──────────────────────────────────────────────────────────────────

type AttendeeResponse = "accepted" | "declined" | "tentative" | "needsAction";

export async function updateGoogleAttendeeRsvp(opts: {
  linkId: string;
  calendarId?: string;
  eventId: string;
  attendeeEmail: string;
  response: AttendeeResponse;
}): Promise<void> {
  const token = await getValidAccessTokenForLink(opts.linkId);
  const calendarId = encodeURIComponent(opts.calendarId ?? "primary");
  // Fetch the event so we can patch the attendees array (Google requires the
  // full list on update, identified by email).
  const getRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(opts.eventId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!getRes.ok) {
    const detail = await extractGoogleErrorDetail(getRes);
    throw new Error(`Google events.get failed (${getRes.status}): ${detail}`);
  }
  const event = (await getRes.json()) as {
    attendees?: { email: string; responseStatus?: AttendeeResponse; displayName?: string }[];
  };
  const attendees = (event.attendees ?? []).map((a) =>
    a.email.toLowerCase() === opts.attendeeEmail.toLowerCase()
      ? { ...a, responseStatus: opts.response }
      : a,
  );
  // Ensure the attendee exists in the list (caller may be a participant the
  // organizer added without us having seen this email yet).
  if (!attendees.some((a) => a.email.toLowerCase() === opts.attendeeEmail.toLowerCase())) {
    attendees.push({ email: opts.attendeeEmail, responseStatus: opts.response });
  }
  const patchRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(opts.eventId)}?sendUpdates=all`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ attendees }),
    },
  );
  if (!patchRes.ok) {
    const detail = await extractGoogleErrorDetail(patchRes);
    throw new Error(`Google events.patch failed (${patchRes.status}): ${detail}`);
  }
}
