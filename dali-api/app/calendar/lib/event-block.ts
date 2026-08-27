import React from "react";
import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";
import type { EventAttendeeDTO, MeetingInviteDTO, TimeEntryDTO } from "~/calendar/lib/types";

// Hard-coded dark text that doesn't flip in dark mode (the dark-blue token does).
export const EVENT_TEXT = "text-[hsl(203_38%_18%)]";
export const EVENT_CORAL = `bg-accent-coral-light ${EVENT_TEXT}`;

// Classes-this-term blocks use the brand navy (every accent token is already
// claimed by blocks/meetings/roles). Dark enough to carry white ink, distinct
// from the coral/teal/green/pink/yellow the other layers use. Applied via the
// EventBlock.bgColor escape hatch, so text flips to a readable on-colour shade.
export const CLASS_BG = "#1E5779";

// Schedule-preview availability tint: interpolate from white (no one free) to a
// deep sage (everyone free) by `frac` (0..1). Lerping the color itself — not
// just opacity over a fixed light green — gives real contrast between the
// "few free" and "all free" ends. Deep end is a darkened accent-green
// (#A2D483) so it matches the brand palette while still reading clearly.
export const AVAIL_DEEP_GREEN: [number, number, number] = [92, 145, 72]; // #5C9148
export function availabilityTint(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  const r = Math.round(255 + (AVAIL_DEEP_GREEN[0] - 255) * f);
  const g = Math.round(255 + (AVAIL_DEEP_GREEN[1] - 255) * f);
  const b = Math.round(255 + (AVAIL_DEEP_GREEN[2] - 255) * f);
  return `rgb(${r}, ${g}, ${b})`;
}

// Visible hour rows: the full day, midnight through 11pm (grid bottom edge is
// midnight). Every downstream bound derives from HOURS[0] / last+1.
export const HOURS = Array.from({ length: 24 }, (_, i) => i);
export const HOUR_PX = 54;
// When the grid scrolls internally, open it here (7 AM) instead of pinned to
// midnight; the rest of the 24h day stays reachable by scrolling up/down.
export const INITIAL_SCROLL_HOUR = 7;
// Grid is snapped/subdivided into 10-minute cells.
export const SUBDIVISIONS_PER_HOUR = 6; // 60 / 10
export const SNAP_HOURS = 1 / SUBDIVISIONS_PER_HOUR; // 10 minutes as a fraction of an hour

export const RSVP_BADGE: Record<"Accepted" | "Declined" | "Tentative", string> = {
  Accepted: "bg-green-100 text-green-800",
  Declined: "bg-red-100 text-red-800",
  Tentative: "bg-yellow-100 text-yellow-800",
};

export const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Dot colour per response, so the guest list scans by status without needing a
// badge on every row. Pending is a hollow ring — nothing to report yet.
export const ATTENDEE_DOT: Record<EventAttendeeDTO["status"], string> = {
  Accepted: "bg-green-600",
  Declined: "bg-red-500",
  Tentative: "bg-yellow-500",
  Pending: "border border-muted-foreground/60",
};

// Long invite lists (a whole-lab event) would push the rest of the card out of
// reach, so collapse past this many and let the user expand.
export const GUESTS_COLLAPSED = 6;

export const STRIPE_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(120,120,120,0.35) 0 6px, transparent 6px 12px)",
  backgroundColor: "rgba(120,120,120,0.25)",
};

// datetime-local strings: "YYYY-MM-DDTHH:mm" in the user's local timezone.
export function durationMinutesBetween(startLocal: string, endLocal: string): number {
  if (!startLocal || !endLocal) return 30;
  const s = new Date(startLocal).getTime();
  const e = new Date(endLocal).getTime();
  if (isNaN(s) || isNaN(e) || e <= s) return 30;
  return Math.round((e - s) / 60_000);
}

// Format a Date as the "YYYY-MM-DDTHH:mm" string a datetime-local input expects,
// in the browser's local timezone (no UTC offset suffix).
export function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// Map a grid day column (UTC-midnight anchored, as the WeekGrid stores its days)
// + a fractional hour into the "YYYY-MM-DDTHH:mm" datetime-local string. Shared
// by the schedule grid and the availability drag-to-create handler.
export function dayHourToLocal(dayDateUtc: Date, hour: number): string {
  const y = dayDateUtc.getUTCFullYear();
  const m = dayDateUtc.getUTCMonth();
  const d = dayDateUtc.getUTCDate();
  const h = Math.floor(hour);
  const mins = Math.round((hour - h) * 60);
  return toDatetimeLocal(new Date(y, m, d, h, mins));
}

// Small fixed palette for coloring Timesheet blocks by role — accent-coral is
// reserved for "other calendars" context blocks, so it's excluded here.
// All four fills are light brand accents, so they take the same dark ink every
// other event block uses — white washed out on the green and pink, and
// `text-foreground` inverted to near-white on the yellow in dark mode.
export const ROLE_COLOR_PALETTE: { className: string; borderClassName: string; dot: string }[] = [
  { className: `bg-accent-teal ${EVENT_TEXT}`, borderClassName: "border-accent-teal", dot: "var(--color-accent-teal)" },
  { className: `bg-accent-green ${EVENT_TEXT}`, borderClassName: "border-accent-green", dot: "var(--color-accent-green)" },
  { className: `bg-accent-pink ${EVENT_TEXT}`, borderClassName: "border-accent-pink", dot: "var(--color-accent-pink)" },
  { className: `bg-accent-yellow ${EVENT_TEXT}`, borderClassName: "border-accent-yellow", dot: "var(--color-accent-yellow)" },
];

// Deterministic hash of a role bucket key into the palette — stable across
// reloads/re-renders without needing to persist a color assignment anywhere.
export function roleColor(key: string): (typeof ROLE_COLOR_PALETTE)[number] {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return ROLE_COLOR_PALETTE[Math.abs(hash) % ROLE_COLOR_PALETTE.length]!;
}

export const UNASSIGNED_ROLE_KEY = "unassigned";

export function timeEntryRoleKey(t: TimeEntryDTO): string {
  return t.assignmentType && t.roleRefId ? `${t.assignmentType}:${t.roleRefId}` : UNASSIGNED_ROLE_KEY;
}

// RSVP status → block styling on the calendar. Pending (unanswered) invites get
// a dashed teal outline to read as "needs response"; answered ones adopt a
// solid tint keyed to the response (declined is muted/greyed).
export function meetingBlockStyle(rsvp: MeetingInviteDTO["rsvp"]): {
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

// Given a calendar day (any value whose UTC Y/M/D is the intended day — a
// plain "YYYY-MM-DD" input value, or a TimeEntry.date, both of which encode
// the picked day as UTC midnight) and a duration, returns a nominal
// [startHour, startHour+hours) range on that day in `timezone`. Used so a
// quick-add entry (no time-of-day picked) still places as a real block on
// the Timesheet week grid.
export function nominalDayRange(
  dateLike: string,
  hours: number,
  timezone: string,
  startHour = 9,
): { startIso: string; endIso: string } {
  const d = new Date(dateLike);
  const dayStart = zonedDayStartUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), timezone);
  const start = new Date(dayStart.getTime() + startHour * 3_600_000);
  const end = new Date(start.getTime() + Math.max(hours, 0.25) * 3_600_000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

// Combine a "YYYY-MM-DD" day and a "HH:MM" wall-clock time into the real UTC
// instant for that moment in `timezone`, so a typed entry lands on the grid
// exactly where a dragged one would.
export function localDayTimeToIso(date: string, time: string, timezone: string): string | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d || hh === undefined || mm === undefined) return null;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const dayStart = zonedDayStartUtc(y, m, d, timezone);
  return new Date(dayStart.getTime() + (hh * 60 + mm) * 60_000).toISOString();
}

export function todayDateInputValue(timezone: string): string {
  const { year, month, day } = getZonedYMD(new Date(), timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

export function formatBlockRange(startIso: string, endIso: string, timezone: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  const t = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date} · ${t(start)} – ${t(end)}`;
}

// ── Overlap layout ─────────────────────────────────────────────────────────
// Without this, every block is positioned left-0/right-0 and overlapping events
// stack on top of each other (the later one hides the earlier). This packs a
// day's events into side-by-side columns, Google-Calendar style.

/** The minimal geometry the packer needs — a block's vertical extent in hours,
 *  including its buffer frame so a buffered meeting doesn't visually collide. */
export type LaneInput = { startHour: number; duration: number; bufferBefore?: number; bufferAfter?: number };

/** Horizontal placement as fractions of the column width (0..1). */
export type EventLane = { left: number; width: number };

const laneSpan = (e: LaneInput) => ({
  top: e.startHour - (e.bufferBefore ?? 0),
  bottom: e.startHour + e.duration + (e.bufferAfter ?? 0),
});

/** Column-pack a day's events so overlapping ones sit side by side instead of
 *  stacking. Events are grouped into collision clusters (a run of transitively
 *  overlapping blocks), greedily assigned to the first column they fit, then
 *  each expands rightward across columns no later event needs. Returns
 *  {left,width} fractions index-aligned to the input; a block with no overlap
 *  gets the full width ({0,1}). Touching edges (back-to-back) don't count as
 *  overlap, so consecutive meetings stay full width. */
export function computeEventLanes(events: LaneInput[]): EventLane[] {
  const n = events.length;
  const lanes: EventLane[] = new Array(n);
  if (n === 0) return lanes;

  const spans = events.map(laneSpan);
  const overlaps = (a: number, b: number) => spans[a].top < spans[b].bottom && spans[b].top < spans[a].bottom;

  // Pack in start order (longer first on ties) so a column's last-added event is
  // always its latest — checking only that last event is enough to place.
  const order = [...Array(n).keys()].sort((i, j) => spans[i].top - spans[j].top || spans[j].bottom - spans[i].bottom);

  let columns: number[][] = [];
  let clusterBottom = -Infinity;

  const flush = () => {
    const numCols = columns.length;
    for (let c = 0; c < numCols; c++) {
      for (const idx of columns[c]) {
        let colSpan = 1;
        for (let c2 = c + 1; c2 < numCols; c2++) {
          if (columns[c2].some((o) => overlaps(idx, o))) break;
          colSpan++;
        }
        lanes[idx] = { left: c / numCols, width: colSpan / numCols };
      }
    }
    columns = [];
  };

  for (const idx of order) {
    if (spans[idx].top >= clusterBottom) {
      flush();
      clusterBottom = -Infinity;
    }
    const col = columns.find((c) => !overlaps(idx, c[c.length - 1]));
    if (col) col.push(idx);
    else columns.push([idx]);
    clusterBottom = Math.max(clusterBottom, spans[idx].bottom);
  }
  flush();
  return lanes;
}

export function shiftWeekParam(weekStartIso: string, weeks: number): string {
  const d = new Date(weekStartIso);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  // YYYY-MM-DD is enough — the loader snaps to the Sunday of that week.
  return d.toISOString().slice(0, 10);
}
