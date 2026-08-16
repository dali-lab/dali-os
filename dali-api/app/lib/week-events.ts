import type { GeneralCalendarEvent } from "~/lib/general-calendar";
import type {
  WeekDayDTO,
  WeekEvent,
  WeekEventKind,
} from "~/components/WeekCalendarPanel";
import type { MonthDayDTO, MonthEvent } from "~/components/MonthCalendarPanel";
import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";

/**
 * The Sunday→Sunday window a week grid shows, in the viewer's timezone, plus
 * its day-column headers. `?week=<n>` shifts it (0 = this week, -1 = last),
 * bounded so a hand-edited URL can't ask an expander for an absurd range.
 */
export function resolveWeekWindow(
  request: Request,
  timeZone: string,
  now = new Date(),
): { weekOffset: number; weekStart: Date; weekEnd: Date; weekDays: WeekDayDTO[] } {
  const raw = Number(new URL(request.url).searchParams.get("week"));
  const weekOffset = Number.isFinite(raw)
    ? Math.trunc(Math.min(52, Math.max(-52, raw)))
    : 0;

  const ymd = getZonedYMD(now, timeZone);
  const todayMidnightUtc = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  const dow = todayMidnightUtc.getUTCDay();
  const sundayUtc = new Date(
    todayMidnightUtc.getTime() + (weekOffset * 7 - dow) * 86_400_000,
  );
  const weekStart = zonedDayStartUtc(
    sundayUtc.getUTCFullYear(),
    sundayUtc.getUTCMonth() + 1,
    sundayUtc.getUTCDate(),
    timeZone,
  );
  const nextSundayUtc = new Date(sundayUtc.getTime() + 7 * 86_400_000);
  const weekEnd = zonedDayStartUtc(
    nextSundayUtc.getUTCFullYear(),
    nextSundayUtc.getUTCMonth() + 1,
    nextSundayUtc.getUTCDate(),
    timeZone,
  );

  const weekDays: WeekDayDTO[] = Array.from({ length: 7 }).map((_, i) => {
    const dy = getZonedYMD(new Date(weekStart.getTime() + i * 86_400_000), timeZone);
    return {
      num: dy.day,
      isToday: dy.year === ymd.year && dy.month === ymd.month && dy.day === ymd.day,
    };
  });

  return { weekOffset, weekStart, weekEnd, weekDays };
}

// Place a start/end span onto the shared week grid, or null when it falls
// outside the seven columns. One owner for the column/offset arithmetic, which
// both the Home week and the Core Hub week feed.
export function toWeekEvent(
  input: {
    id: string;
    kind: WeekEventKind;
    label: string;
    start: Date;
    end: Date;
    location?: string | null;
    description?: string | null;
    organizer?: string | null;
    url?: string | null;
    href?: string | null;
  },
  weekStart: Date,
  timeZone: string,
): WeekEvent | null {
  const ymd = getZonedYMD(input.start, timeZone);
  const dayMidnight = zonedDayStartUtc(ymd.year, ymd.month, ymd.day, timeZone);
  const colIdx = Math.round(
    (dayMidnight.getTime() - weekStart.getTime()) / 86_400_000,
  );
  if (colIdx < 0 || colIdx > 6) return null;
  return {
    id: input.id,
    kind: input.kind,
    colIdx,
    startHour: (input.start.getTime() - dayMidnight.getTime()) / 3_600_000,
    // Sub-30-minute events would render as an unreadable sliver.
    duration: Math.max(0.5, (input.end.getTime() - input.start.getTime()) / 3_600_000),
    label: input.label,
    startAt: input.start.toISOString(),
    endAt: input.end.toISOString(),
    location: input.location ?? null,
    description: input.description ?? null,
    organizer: input.organizer ?? null,
    url: input.url ?? null,
    href: input.href ?? null,
  };
}

/**
 * The DALI General Calendar feed as week-grid events. All-day entries are
 * dropped — they have no place on an hour grid — and the ICS feed carries no
 * stable per-occurrence id, so one is derived from the start instant.
 */
export function generalCalendarWeekEvents(
  events: readonly GeneralCalendarEvent[],
  weekStart: Date,
  timeZone: string,
): WeekEvent[] {
  const out: WeekEvent[] = [];
  for (const ev of events) {
    if (ev.allDay) continue;
    const mapped = toWeekEvent(
      {
        id: `ics:${ev.start.toISOString()}:${ev.summary}`,
        kind: "general",
        label: ev.summary,
        start: ev.start,
        end: ev.end,
        location: ev.location,
        description: ev.description,
        organizer: ev.organizer,
        url: ev.url,
      },
      weekStart,
      timeZone,
    );
    if (mapped) out.push(mapped);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Month grid                                                          */
/* ------------------------------------------------------------------ */

const pad2 = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

/**
 * The month window a month grid shows, in the viewer's timezone. `?month=<n>`
 * shifts it (0 = this month), bounded like `?week=` so a hand-edited URL can't
 * ask an expander for an absurd range.
 *
 * The grid always spans whole Sunday→Saturday rows, so it carries a few days
 * of the neighbouring months (`inMonth: false`).
 */
export function resolveMonthWindow(
  request: Request,
  timeZone: string,
  now = new Date(),
): {
  monthOffset: number;
  gridStart: Date;
  gridEnd: Date;
  monthDays: MonthDayDTO[];
  monthLabel: string;
} {
  const raw = Number(new URL(request.url).searchParams.get("month"));
  const monthOffset = Number.isFinite(raw)
    ? Math.trunc(Math.min(24, Math.max(-24, raw)))
    : 0;

  const today = getZonedYMD(now, timeZone);
  // Month arithmetic runs on UTC calendar dates so rollover is exact; the
  // timezone only re-enters when a cell is turned back into an instant.
  const anchor = new Date(Date.UTC(today.year, today.month - 1 + monthOffset, 1));
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leading = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const cells = Math.ceil((leading + daysInMonth) / 7) * 7;
  const gridFirst = new Date(Date.UTC(year, month, 1 - leading));

  const todayMidnight = new Date(Date.UTC(today.year, today.month - 1, today.day));

  const monthDays: MonthDayDTO[] = Array.from({ length: cells }).map((_, i) => {
    const d = new Date(gridFirst.getTime() + i * 86_400_000);
    return {
      num: d.getUTCDate(),
      key: dateKey(d),
      inMonth: d.getUTCMonth() === month,
      isToday: d.getTime() === todayMidnight.getTime(),
    };
  });

  const gridLast = new Date(gridFirst.getTime() + cells * 86_400_000);
  return {
    monthOffset,
    gridStart: zonedDayStartUtc(
      gridFirst.getUTCFullYear(),
      gridFirst.getUTCMonth() + 1,
      gridFirst.getUTCDate(),
      timeZone,
    ),
    gridEnd: zonedDayStartUtc(
      gridLast.getUTCFullYear(),
      gridLast.getUTCMonth() + 1,
      gridLast.getUTCDate(),
      timeZone,
    ),
    monthDays,
    monthLabel: new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month, 1))),
  };
}

/** Cell index for each day of a month grid, keyed by local calendar date. */
export function monthDayIndex(days: readonly MonthDayDTO[]): Map<string, number> {
  return new Map(days.map((d, i) => [d.key, i]));
}

/**
 * Place an event on the month grid, or null when it falls outside it. Unlike
 * the week grid this keeps all-day entries — a day cell is a list, not an hour
 * column, so they have somewhere to go.
 */
export function toMonthEvent(
  input: {
    id: string;
    kind: WeekEventKind;
    label: string;
    start: Date;
    allDay?: boolean;
    href?: string | null;
  },
  dayIndexByKey: ReadonlyMap<string, number>,
  timeZone: string,
): MonthEvent | null {
  const ymd = getZonedYMD(input.start, timeZone);
  const dayIdx = dayIndexByKey.get(
    `${ymd.year}-${pad2(ymd.month)}-${pad2(ymd.day)}`,
  );
  if (dayIdx === undefined) return null;
  return {
    id: input.id,
    kind: input.kind,
    dayIdx,
    label: input.label,
    startAt: input.start.toISOString(),
    allDay: input.allDay ?? false,
    href: input.href ?? null,
  };
}

/** The DALI General Calendar feed as month-grid events. */
export function generalCalendarMonthEvents(
  events: readonly GeneralCalendarEvent[],
  dayIndexByKey: ReadonlyMap<string, number>,
  timeZone: string,
): MonthEvent[] {
  const out: MonthEvent[] = [];
  for (const ev of events) {
    const mapped = toMonthEvent(
      {
        id: `ics:${ev.start.toISOString()}:${ev.summary}`,
        kind: "general",
        label: ev.summary,
        start: ev.start,
        allDay: ev.allDay,
      },
      dayIndexByKey,
      timeZone,
    );
    if (mapped) out.push(mapped);
  }
  return out;
}
