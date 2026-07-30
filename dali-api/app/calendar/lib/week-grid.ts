// Pure, presentational primitives shared by the member week calendar
// (app/calendar/routes/calendar.tsx) and the read-only partner project
// calendar (app/partners/components/PartnerWeekCalendar.tsx).
//
// Leaf module: depends only on ~/lib/timezone. It must NOT import calendar.tsx
// or any server/Prisma code, so importing it from the partner bundle doesn't
// drag the 5,900-line member route (and its loaders) along.
import { useEffect, useState } from "react";
import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";

/** RSVP value shared by member invites and partner meeting responses. */
export type MeetingRsvpValue = "Accepted" | "Declined" | "Tentative" | null;

// Visible hour rows: the full day, midnight through 11pm (grid bottom edge is
// midnight). Every downstream bound derives from HOURS[0] / last+1.
export const HOURS = Array.from({ length: 24 }, (_, i) => i);
export const HOUR_PX = 54;
// Grid is snapped/subdivided into 10-minute cells.
export const SUBDIVISIONS_PER_HOUR = 6; // 60 / 10
export const SNAP_HOURS = 1 / SUBDIVISIONS_PER_HOUR; // 10 minutes as a fraction of an hour

export const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const EVENT_TEXT = "text-[hsl(203_38%_18%)]";

// Window for the visible week grid. We compute Sunday→following Sunday in the
// given timezone (the grid renders Sun..Sat columns). When `anchor` is provided
// it picks the Sunday of that date's week; otherwise it uses "now".
export function weekWindow(timezone: string, anchor?: Date): { start: Date; end: Date } {
  const ref = anchor ?? new Date();
  const ymd = getZonedYMD(ref, timezone);
  const refUtcMidnight = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  const dow = refUtcMidnight.getUTCDay();
  const sundayUtc = new Date(refUtcMidnight.getTime() - dow * 86_400_000);
  const start = zonedDayStartUtc(
    sundayUtc.getUTCFullYear(),
    sundayUtc.getUTCMonth() + 1,
    sundayUtc.getUTCDate(),
    timezone,
  );
  const nextSundayUtc = new Date(sundayUtc.getTime() + 7 * 86_400_000);
  const end = zonedDayStartUtc(
    nextSundayUtc.getUTCFullYear(),
    nextSundayUtc.getUTCMonth() + 1,
    nextSundayUtc.getUTCDate(),
    timezone,
  );
  return { start, end };
}

// Ticking "current time" used to draw the now-line. Returns null on the first
// render so SSR and the initial client paint agree (no hydration mismatch),
// then fills in after mount and re-ticks every `intervalMs`.
export function useNow(intervalMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatHour(h: number) {
  if (h === 12) return "12 PM";
  if (h === 0) return "12 AM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

// Fractional hour → "9:15 AM" / "12:00 PM" style label for drag tooltips.
export function formatHourMinute(h: number) {
  const totalMin = Math.round(h * 60);
  const hour24 = Math.floor(totalMin / 60) % 24;
  const minute = totalMin % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

// Pick dark or light ink for a solid fill by its perceived luminance, so
// custom event colors (which arrive as arbitrary hex — light Google "Banana"
// through dark "Blueberry") stay readable instead of always getting white text.
// Falls back to white for anything we can't parse as a hex color.
export function readableTextColor(bg: string): string {
  const hex = bg.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.replace(/(.)/g, "$1$1") : hex;
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Rec. 601 luma; above ~0.6 the fill reads as light → switch to dark ink.
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? "#1e2733" : "#ffffff";
}

// RSVP status → block styling on the calendar. Pending (unanswered) invites get
// a dashed teal outline to read as "needs response"; answered ones adopt a
// solid tint keyed to the response (declined is muted/greyed).
export function meetingBlockStyle(rsvp: MeetingRsvpValue): {
  className: string;
  borderClassName: string;
} {
  switch (rsvp) {
    case "Accepted":
      return { className: `bg-accent-teal-light ${EVENT_TEXT}`, borderClassName: "border-accent-teal" };
    case "Tentative":
      return { className: `bg-accent-yellow ${EVENT_TEXT}`, borderClassName: "border-accent-yellow" };
    case "Declined":
      return { className: "bg-muted text-muted-foreground line-through", borderClassName: "border-border" };
    default:
      return { className: `bg-accent-teal-light ${EVENT_TEXT}`, borderClassName: "border-dashed border-accent-teal" };
  }
}
