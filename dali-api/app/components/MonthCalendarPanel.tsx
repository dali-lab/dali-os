import { Link } from "react-router";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "~/lib/cn";

// Month companion to WeekCalendarPanel. A month can't carry an hour grid, so
// each day is a list of chips instead of positioned blocks. Cells are inert:
// the only thing that navigates is a meeting chip, which opens its notes.
// Paged by `?month=<n>` the same way the week grid is paged by `?week=<n>`.

export type MonthDayDTO = {
  /** Day-of-month number. */
  num: number;
  /** Local calendar date, "yyyy-mm-dd" — the key events are placed by. */
  key: string;
  isToday: boolean;
  /** False for the leading/trailing days borrowed from neighbouring months. */
  inMonth: boolean;
};

export type MonthEvent = {
  id: string;
  kind: "general" | "meeting";
  /** Index into the panel's day cells. */
  dayIdx: number;
  label: string;
  startAt: string;
  allDay: boolean;
  href?: string | null;
};

const DAY_HEADS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Same source-keyed tints as the week grid, so an event reads the same colour
// in both views. Dark text is fixed rather than themed — it is only ever on
// these light fills.
const EVENT_TEXT = "text-[hsl(203_38%_18%)]";
const EVENT_FILLS: Record<MonthEvent["kind"], string> = {
  general: `bg-accent-teal-light ${EVENT_TEXT}`,
  meeting: `bg-accent-coral-light ${EVENT_TEXT}`,
};
// Past three chips a cell stops being scannable; the rest go behind a count
// that opens the week.
const MAX_CHIPS = 3;

export function MonthCalendarPanel({
  days,
  events,
  monthOffset,
  monthLabel,
  timeZone,
  basePath = "/",
  sourceLabel = "DALI General Calendar",
}: {
  days: MonthDayDTO[];
  events: MonthEvent[];
  monthOffset: number;
  monthLabel: string;
  timeZone: string;
  /** Route the month paging and day links point at. */
  basePath?: string;
  sourceLabel?: string;
}) {
  const monthHref = (offset: number) =>
    offset === 0 ? basePath : `${basePath}?month=${offset}`;

  const byDay = new Map<number, MonthEvent[]>();
  for (const ev of events) {
    const list = byDay.get(ev.dayIdx);
    if (list) list.push(ev);
    else byDay.set(ev.dayIdx, [ev]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startAt.localeCompare(b.startAt));
  }

  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(iso));

  const rows = Math.ceil(days.length / 7);

  return (
    <section className="bg-card border border-border shadow-brand-1 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
            <CalendarDays className="w-4 h-4 text-accent-coral" />
            {monthLabel}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{sourceLabel}</p>
        </div>
        <div className="flex items-center gap-1">
          {monthOffset !== 0 && (
            <Link
              to={monthHref(0)}
              prefetch="intent"
              className="px-2 py-1 text-xs font-medium rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              Today
            </Link>
          )}
          <Link
            to={monthHref(monthOffset - 1)}
            prefetch="intent"
            aria-label="Previous month"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <Link
            to={monthHref(monthOffset + 1)}
            prefetch="intent"
            aria-label="Next month"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px">
        {DAY_HEADS.map((d) => (
          <div
            key={d}
            className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{d[0]}</span>
          </div>
        ))}
      </div>

      <div
        className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border"
        style={{ gridTemplateRows: `repeat(${rows}, minmax(5.5rem, auto))` }}
      >
        {days.map((day, idx) => {
          const dayEvents = byDay.get(idx) ?? [];
          const shown = dayEvents.slice(0, MAX_CHIPS);
          const hidden = dayEvents.length - shown.length;
          return (
            <div
              key={day.key}
              className={cn(
                "flex flex-col gap-1 p-1.5",
                day.inMonth ? "bg-card" : "bg-muted/30",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center self-start rounded-full px-1 text-xs font-semibold tabular-nums",
                  day.isToday
                    ? "bg-accent-coral text-white"
                    : day.inMonth
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {day.num}
              </span>
              {shown.map((ev) => {
                const title = ev.allDay
                  ? ev.label
                  : `${time(ev.startAt)} · ${ev.label}`;
                const text = ev.allDay ? ev.label : `${time(ev.startAt)} ${ev.label}`;
                const chip = cn(
                  "block truncate rounded px-1 py-0.5 text-[11px] font-medium leading-tight",
                  EVENT_FILLS[ev.kind],
                );
                // A meeting with a note is the only thing on the grid that
                // navigates; the day itself is not a link.
                return ev.href ? (
                  <Link
                    key={ev.id}
                    to={ev.href}
                    prefetch="intent"
                    title={`${title} — open notes`}
                    className={cn(chip, "hover:underline")}
                  >
                    {text}
                  </Link>
                ) : (
                  <span key={ev.id} title={title} className={chip}>
                    {text}
                  </span>
                );
              })}
              {hidden > 0 && (
                <span className="px-1 text-[11px] font-medium text-muted-foreground">
                  +{hidden} more
                </span>
              )}
            </div>
          );
        })}
      </div>

    </section>
  );
}
