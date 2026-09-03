import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";
import type { CalendarView } from "~/calendar/lib/types";

// The visible-range maths, shared by the loader and the calendar screen.
//
// This lives outside `calendar.server.ts` on purpose. Switching month / week /
// day used to be a navigation whose result the client could only learn from the
// loader — so every toggle waited on a server round-trip that went out to
// Google. With the same functions available on the client, the screen computes
// its own day columns and a view switch repaints immediately.
//
// Only `~/lib/timezone` is imported here, so the module stays client-safe (no
// Prisma, no server-only config).

/** `?anchor=YYYY-MM-DD` → the instant the windows below key off. Noon UTC keeps
 *  the date stable when it is shifted into a timezone either side of UTC. */
export function parseAnchor(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymd) return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function parseView(v: string | null): CalendarView {
  return v === "day" || v === "month" || v === "agenda" ? v : "week";
}

/** Sunday → the following Sunday, in the viewer's timezone. */
export function weekWindow(timezone: string, anchor?: Date): { start: Date; end: Date } {
  const ref = anchor ?? new Date();
  const ymd = getZonedYMD(ref, timezone);
  const refUtcMidnight = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  const sundayUtc = new Date(refUtcMidnight.getTime() - refUtcMidnight.getUTCDay() * 86_400_000);
  const nextSundayUtc = new Date(sundayUtc.getTime() + 7 * 86_400_000);
  const snap = (d: Date) =>
    zonedDayStartUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), timezone);
  return { start: snap(sundayUtc), end: snap(nextSundayUtc) };
}

/**
 * The range the screen shows. Day = the anchor's calendar day; Week =
 * `weekWindow`; Month/Agenda = the Sunday on/before the 1st .. the Sunday after
 * the last day (the 5–6 week grid). Boundaries snap through `zonedDayStartUtc`
 * so they stay DST-correct.
 */
export function viewWindow(
  timezone: string,
  view: CalendarView,
  anchor?: Date,
): { start: Date; end: Date } {
  if (view === "week") return weekWindow(timezone, anchor);
  const ymd = getZonedYMD(anchor ?? new Date(), timezone);
  const snap = (d: Date) =>
    zonedDayStartUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), timezone);
  if (view === "day") {
    return {
      start: zonedDayStartUtc(ymd.year, ymd.month, ymd.day, timezone),
      end: snap(new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day) + 86_400_000)),
    };
  }
  const firstUtc = new Date(Date.UTC(ymd.year, ymd.month - 1, 1));
  const gridStartUtc = new Date(firstUtc.getTime() - firstUtc.getUTCDay() * 86_400_000);
  const lastUtc = new Date(Date.UTC(ymd.year, ymd.month, 0));
  const gridEndUtc = new Date(lastUtc.getTime() + (7 - lastUtc.getUTCDay()) * 86_400_000);
  return { start: snap(gridStartUtc), end: snap(gridEndUtc) };
}

/**
 * The window the loader actually fetches from Google: the month grid around the
 * anchor, padded a week each side, so day / week / month at one anchor are all
 * subsets of a single fetch. That is what lets a view switch avoid the network
 * entirely — the data on hand already covers the new range.
 */
export function fetchWindow(timezone: string, anchor?: Date): { start: Date; end: Date } {
  const { start, end } = viewWindow(timezone, "month", anchor);
  return {
    start: new Date(start.getTime() - 7 * 86_400_000),
    end: new Date(end.getTime() + 7 * 86_400_000),
  };
}
