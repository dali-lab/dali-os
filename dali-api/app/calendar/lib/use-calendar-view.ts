import { useSearchParams } from "react-router";
import { buildGridDays, type GridDay } from "~/calendar/lib/layers";
import { parseAnchor, parseView, viewWindow } from "~/calendar/lib/view-window";
import type { CalendarView } from "~/calendar/lib/types";

// The month/week/day/agenda URL state every calendar surface shares: which view
// is showing, which days it spans, what to call the range, and the four moves
// that change it. Derived entirely from `?view=` / `?anchor=` on the client
// (see view-window.ts), so a view switch repaints from data already in hand.
//
// It lives here rather than in the Events page because the Core hub renders the
// same grids off its own loader — one implementation keeps the two pages paging
// and labelling identically.

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** A grid day's UTC-anchored date as `YYYY-MM-DD` — the `?anchor=` format. */
export function ymdUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export type CalendarViewState = {
  view: CalendarView;
  rangeStart: Date;
  rangeEnd: Date;
  days: GridDay[];
  /** The day the view is centred on — what prev/next and the label key off. */
  focusDate: Date;
  /** 1-based month the view sits in; days outside it are dimmed in month view. */
  anchorMonth: { year: number; month: number };
  rangeLabel: string;
  changeView: (v: CalendarView) => void;
  /** Page by one day / week / month, in the direction of `delta`. */
  navigate: (delta: number) => void;
  goToday: () => void;
  /** Drill into one day (a month cell, a mini-month pick). */
  goToDay: (dateUtc: Date) => void;
};

export function useCalendarView(timezone: string): CalendarViewState {
  const [searchParams, setSearchParams] = useSearchParams();

  const view = parseView(searchParams.get("view"));
  const anchorParam = parseAnchor(searchParams.get("anchor") ?? searchParams.get("weekStart"));
  const { start: rangeStart, end: rangeEnd } = viewWindow(timezone, view, anchorParam);
  const dayCount = Math.max(
    1,
    Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000),
  );
  const days = buildGridDays(rangeStart.toISOString(), dayCount);
  // For month view rangeStart is the Sunday before the 1st, so +14d lands
  // mid-month. Agenda shares the month window, so its focus tracks the month too.
  const focusDate =
    view === "month" || view === "agenda"
      ? new Date(rangeStart.getTime() + 14 * 86_400_000)
      : rangeStart;
  const anchorMonth = { year: focusDate.getUTCFullYear(), month: focusDate.getUTCMonth() + 1 };

  const setParams = (mut: (p: URLSearchParams) => void) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        mut(p);
        return p;
      },
      { preventScrollReset: true },
    );

  const df = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...opts }).format(d);
  let rangeLabel: string;
  if (view === "day")
    rangeLabel = df(focusDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  else if (view === "month" || view === "agenda")
    rangeLabel = df(focusDate, { month: "long", year: "numeric" });
  else {
    const last = days[days.length - 1].dateUtc;
    rangeLabel = `${df(rangeStart, { month: "short", day: "numeric" })} – ${df(last, {
      month: "short",
      day: "numeric",
    })}, ${df(last, { year: "numeric" })}`;
  }

  return {
    view,
    rangeStart,
    rangeEnd,
    days,
    focusDate,
    anchorMonth,
    rangeLabel,
    // Touches `view` and nothing else. An absent anchor already means "today",
    // which every view resolves correctly on its own — and leaving the rest of
    // the query identical is what lets shouldRevalidate skip the loader.
    changeView: (v) => setParams((p) => p.set("view", v)),
    navigate: (delta) => {
      const d = new Date(focusDate);
      if (view === "day") d.setUTCDate(d.getUTCDate() + delta);
      else if (view === "week") d.setUTCDate(d.getUTCDate() + delta * 7);
      else d.setUTCMonth(d.getUTCMonth() + delta);
      setParams((p) => {
        p.set("view", view);
        p.set("anchor", ymdUtc(d));
        p.delete("weekStart");
      });
    },
    goToday: () =>
      setParams((p) => {
        p.set("view", view);
        p.delete("anchor");
        p.delete("weekStart");
      }),
    goToDay: (dateUtc) =>
      setParams((p) => {
        p.set("view", "day");
        p.set("anchor", ymdUtc(dateUtc));
        p.delete("weekStart");
      }),
  };
}
