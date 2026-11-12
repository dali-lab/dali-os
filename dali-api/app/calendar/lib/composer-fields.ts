import { getZonedYMD } from "~/lib/timezone";
import type { LoaderData, MemberClassDTO, CalendarLinkDTO } from "~/calendar/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────


export const dtPad = (n: number) => String(n).padStart(2, "0");

// ISO instant → { date:"YYYY-MM-DD", time:"HH:mm" } as wall-clock in `timezone`,
// so the composer's fields match where the grid actually places the event. The
// grid renders in the user's configured timezone, which may differ from the
// browser's — reading the instant with getHours() (browser-local) would drift.
export function isoToZonedFields(iso: string, timezone: string): { date: string; time: string } {
  const { year, month, day } = getZonedYMD(new Date(iso), timezone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  let hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  if (hh === "24") hh = "00"; // some ICU builds render midnight as "24"
  return { date: `${year}-${dtPad(month)}-${dtPad(day)}`, time: `${hh}:${mm}` };
}

export function isoToDateInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10); // all-day = UTC-midnight date
}

export function addDaysToDate(dateStr: string, days: number): string {
  return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Where a new event can go: any writable Google calendar. */
export function eventDestinations(data: LoaderData): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const link of data.calendarLinks) {
    if (link.provider !== "Google" || !link.subCalendars) continue;
    const account = link.displayName || link.externalEmail || "Google";
    for (const sub of link.subCalendars) {
      if (!sub.writable) continue;
      out.push({ value: `${link.id}:${sub.id}`, label: `${account} · ${sub.primary ? "Primary" : sub.summary}` });
    }
  }
  return out;
}

/**
 * Where a meeting invite can be sent from: each writable calendar inside each
 * enabled Google account, same "<linkId>:<calendarId>" values as
 * eventDestinations. An account whose calendars Google wouldn't list still
 * gets one entry ("<linkId>:", no calendar) that sends from its primary.
 */
export function inviteDestinations(links: CalendarLinkDTO[]): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const link of links) {
    if (link.provider !== "Google" || !link.enabled) continue;
    const account = link.displayName || link.externalEmail || "Google";
    const writable = (link.subCalendars ?? []).filter((sub) => sub.writable);
    if (writable.length === 0) {
      out.push({ value: `${link.id}:`, label: account });
      continue;
    }
    for (const sub of writable) {
      out.push({ value: `${link.id}:${sub.id}`, label: `${account} · ${sub.primary ? "Primary" : sub.summary}` });
    }
  }
  return out;
}

/** The meeting payload's organizer fields for an inviteDestinations value.
 *  Link ids are cuids (no ":"); calendar ids may contain anything after it. */
export function inviteOrganizerFields(
  value: string,
): { organizerCalendarLinkId?: string; organizerCalendarId?: string } {
  const sep = value.indexOf(":");
  const linkId = sep === -1 ? value : value.slice(0, sep);
  const calendarId = sep === -1 ? "" : value.slice(sep + 1);
  if (!linkId) return {};
  return calendarId ? { organizerCalendarLinkId: linkId, organizerCalendarId: calendarId } : { organizerCalendarLinkId: linkId };
}

export const padTwo = (n: number) => String(n).padStart(2, "0");

export const minToHHMM = (m: number) => `${padTwo(Math.floor(m / 60))}:${padTwo(m % 60)}`;

export const CUSTOM_WEEKDAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
];

// The same calendar the class currently writes to, as a destination value — so
// editing a class doesn't silently move it. Dedicated/primary/sub-calendar all
// collapse to their concrete calendarId here, which is what matters.
export function currentDestinationValue(c: MemberClassDTO): string {
  if (c.storage === "Local" || !c.linkId) return "local";
  if (!c.calendarId || c.calendarId === "primary") return `google:${c.linkId}:primary`;
  return `google:${c.linkId}:cal:${c.calendarId}`;
}

// ── ComposerState type ─────────────────────────────────────────────────────
