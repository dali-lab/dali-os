import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  AlignLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  MapPin,
  UserRound,
  X,
} from "lucide-react";
import { getZonedHourFraction } from "~/lib/timezone";

// The shared week grid: seven day columns over a fixed 9am–9pm window, a live
// now-line, prev/next paging driven by the caller's own href, and a detail
// popover anchored beside the clicked block. Lifted out of routes/home.tsx so
// the Core Hub can render the same calendar over a different set of sources.
//
// Events carry a `kind` so multi-source callers colour by where an event came
// from rather than by column position, and an optional `href` for sources that
// have somewhere to go (a Core meeting's notes page).

export type WeekDayDTO = { num: number; isToday: boolean };

export type WeekEventKind = "general" | "meeting";

export type WeekEvent = {
  id: string;
  kind: WeekEventKind;
  colIdx: number;
  startHour: number;
  duration: number;
  label: string;
  startAt: string;
  endAt: string;
  location: string | null;
  description: string | null;
  organizer: string | null;
  url: string | null;
  /** In-app destination for this event, e.g. its meeting-notes page. */
  href?: string | null;
};

/* ------------------------------------------------------------------ */
/* This-week calendar                                                  */
/* ------------------------------------------------------------------ */

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const HOUR_PX = 44;
const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// Ticking "current time" for the now-line. Returns null on the first render so
// SSR and the initial client paint agree (no hydration mismatch), then fills in
// after mount and re-ticks every minute.
function useNow(intervalMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Fixed dark text that doesn't flip in dark mode — paired only with the light
// accent tints below so it stays high-contrast in both themes. (The saturated
// `accent-teal` made dark text hard to read in light mode; use its light twin.)
const EVENT_TEXT = "text-[hsl(203_38%_18%)]";
// Keyed by source so a multi-source grid reads at a glance: lab-wide calendar
// events in teal, meetings this area owns in coral. Single-source callers just
// get one consistent colour.
const EVENT_FILLS: Record<WeekEventKind, string> = {
  general: `bg-accent-teal-light ${EVENT_TEXT}`,
  meeting: `bg-accent-coral-light ${EVENT_TEXT}`,
};

export function WeekCalendarPanel({
  days,
  events,
  weekOffset,
  weekLabel,
  timeZone,
  basePath = "/",
  sourceLabel = "DALI General Calendar",
  emptyLabel = "No events this week, or the DALI General Calendar isn't connected yet.",
}: {
  days: WeekDayDTO[];
  events: WeekEvent[];
  weekOffset: number;
  weekLabel: string;
  timeZone: string;
  /** Route the prev/next week links point at. */
  basePath?: string;
  /** Provenance note beside the week heading. */
  sourceLabel?: string;
  emptyLabel?: string;
}) {
  const hasEvents = events.length > 0;
  const [selected, setSelected] = useState<{
    event: WeekEvent;
    anchor: { colIdx: number; top: number; height: number };
  } | null>(null);
  // Pixel offset of the current-time line within a column body, or null when
  // "now" falls outside the visible 9am–9pm window (line is hidden, not pinned).
  const now = useNow();
  const nowLineTop = (() => {
    if (!now) return null;
    const frac = getZonedHourFraction(now, timeZone);
    if (frac < HOURS[0] || frac >= HOURS[HOURS.length - 1] + 1) return null;
    return (frac - HOURS[0]) * HOUR_PX;
  })();
  // Paging is a plain link, so the loader re-windows the fetch server-side and
  // the week survives a refresh or a shared URL. The caller owns the path.
  const weekHref = (offset: number) =>
    offset === 0 ? basePath : `${basePath}?week=${offset}`;

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  return (
    <section className="bg-card border border-border shadow-brand-1 rounded-lg p-4 flex flex-col overflow-visible">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <CalendarDays className="w-4 h-4 text-accent-coral" />
          {weekOffset === 0 ? "This Week" : weekLabel}
          <span className="text-xs font-normal text-muted-foreground">
            · {sourceLabel}
          </span>
        </h2>
        <div className="flex items-center gap-1">
          {weekOffset !== 0 && (
            <Link
              to={weekHref(0)}
              prefetch="intent"
              className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Today
            </Link>
          )}
          <span className="px-1 text-xs text-muted-foreground tabular-nums">
            {weekOffset === 0 ? weekLabel : ""}
          </span>
          <Link
            to={weekHref(weekOffset - 1)}
            prefetch="intent"
            aria-label="Previous week"
            className="inline-flex items-center rounded-md border border-border p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            to={weekHref(weekOffset + 1)}
            prefetch="intent"
            aria-label="Next week"
            className="inline-flex items-center rounded-md border border-border p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
      {!hasEvents && (
        <p className="mb-2 text-xs text-muted-foreground">{emptyLabel}</p>
      )}
      <div className="relative flex border border-border rounded-md overflow-visible">
        <div className="flex flex-col w-12 border-r border-border bg-card text-[10px] text-muted-foreground shrink-0">
          <div className="h-9 border-b border-border" />
          {HOURS.map((h) => (
            <div key={h} style={{ height: HOUR_PX }} className="px-1.5 pt-0.5 text-right">
              {formatHour(h)}
            </div>
          ))}
        </div>
        {DAY_KEYS.map((key, idx) => (
          <div key={key} className="flex-1 min-w-0 border-r last:border-r-0 border-border flex flex-col">
            <div
              className={`flex flex-col items-center justify-center border-b border-border h-9 ${
                days[idx]?.isToday ? "bg-accent-coral/10" : ""
              }`}
            >
              <div
                className={`text-[9px] font-semibold tracking-wide ${
                  days[idx]?.isToday ? "text-accent-coral" : "text-muted-foreground"
                }`}
              >
                {key}
              </div>
              <div
                className={`text-xs font-bold ${
                  days[idx]?.isToday ? "text-accent-coral" : "text-foreground"
                }`}
              >
                {days[idx]?.num ?? ""}
              </div>
            </div>
            <div className="relative overflow-visible" style={{ height: HOURS.length * HOUR_PX }}>
              {HOURS.map((_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-border/60"
                  style={{ top: i * HOUR_PX }}
                />
              ))}
              {days[idx]?.isToday && nowLineTop != null && (
                <div
                  className="absolute left-0 right-0 h-0.5 bg-accent-coral pointer-events-none z-30"
                  style={{ top: nowLineTop }}
                  aria-label="Current time"
                >
                  <div className="absolute left-0 -top-[3px] w-2 h-2 rounded-full bg-accent-coral" />
                </div>
              )}
              {events
                .filter((e) => e.colIdx === idx)
                .map((e, i) => {
                  // Clamp to the visible 9am–10pm window so off-hours events
                  // still show a sliver at the grid edge rather than overflow.
                  const top = Math.max(0, (e.startHour - HOURS[0]) * HOUR_PX);
                  const rawHeight = e.duration * HOUR_PX;
                  const maxHeight = HOURS.length * HOUR_PX - top;
                  const height = Math.min(rawHeight, maxHeight);
                  const start = formatBlockTime(e.startHour);
                  const end = formatBlockTime(e.startHour + e.duration);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() =>
                        setSelected({ event: e, anchor: { colIdx: idx, top, height } })
                      }
                      // Inset left edge gives the flat tint some depth and mirrors
                      // the /calendar blocks, so home reads as the same system.
                      className={`absolute left-0 right-0 mx-0.5 px-1.5 py-0.5 rounded-sm overflow-hidden text-left shadow-[inset_3px_0_0_0_rgba(0,0,0,0.16)] transition-shadow hover:shadow-[inset_3px_0_0_0_rgba(0,0,0,0.32)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral ${
                        selected?.event.startAt === e.startAt ? "ring-2 ring-accent-coral ring-offset-1" : ""
                      } ${
                        EVENT_FILLS[e.kind]
                      }`}
                      style={{ top, height }}
                      title={`${e.label} · ${start} – ${end}`}
                    >
                      <span className="block text-[10px] font-semibold leading-tight break-words">
                        {e.label}
                      </span>
                      {/* Start time only once the block is tall enough for a
                          second line — short events stay name-only. */}
                      {height >= 26 && (
                        <span className="block text-[9px] font-medium leading-tight opacity-70">
                          {start}
                        </span>
                      )}
                    </button>
                  );
                })}
              {selected?.anchor.colIdx === idx && (
                <EventDetailPanel
                  event={selected.event}
                  anchor={selected.anchor}
                  timeZone={timeZone}
                  onClose={() => setSelected(null)}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Google-Calendar-style detail popover for one event. Anchored beside the
// clicked block inside its day column so the week grid stays in view.
function EventDetailPanel({
  event,
  anchor,
  timeZone,
  onClose,
}: {
  event: WeekEvent;
  anchor: { colIdx: number; top: number; height: number };
  timeZone: string;
  onClose: () => void;
}) {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const dayLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(d);

  // Flip to the left on the last two columns so the card doesn't clip off-screen.
  const flipLeft = anchor.colIdx >= 5;
  const panelTop = Math.max(
    0,
    Math.min(anchor.top, HOURS.length * HOUR_PX - 120),
  );

  return (
    <div
      role="dialog"
      aria-label={event.label}
      className={`absolute z-30 w-64 rounded-lg border border-border bg-card p-3 shadow-brand-2 ${
        flipLeft ? "right-full mr-1.5" : "left-full ml-1.5"
      }`}
      style={{ top: panelTop }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold text-foreground break-words">
            {event.label}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {dayLabel} · {time(start)} – {time(end)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close event details"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <dl className="mt-3 flex flex-col gap-2 text-sm">
        {event.location && (
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <dd className="min-w-0 break-words text-foreground">{event.location}</dd>
          </div>
        )}
        {event.organizer && (
          <div className="flex items-start gap-2">
            <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <dd className="min-w-0 break-words text-foreground">{event.organizer}</dd>
          </div>
        )}
        {event.description && (
          <div className="flex items-start gap-2">
            <AlignLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <dd className="min-w-0 whitespace-pre-wrap break-words text-muted-foreground">
              {event.description}
            </dd>
          </div>
        )}
      </dl>

      {event.href && (
        <Link
          to={event.href}
          prefetch="intent"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent-coral hover:underline"
        >
          <FileText className="h-3.5 w-3.5" />
          Open meeting notes
        </Link>
      )}

      {event.url && (
        <a
          href={event.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 ml-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent-coral hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open in Google Calendar
        </a>
      )}
    </div>
  );
}

// Format a fractional hour-of-day (e.g. 14.5) as "2:30 PM" for event blocks.
function formatBlockTime(hour: number) {
  const h24 = Math.floor(hour);
  const mins = Math.round((hour - h24) * 60);
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return mins === 0
    ? `${h12} ${period}`
    : `${h12}:${String(mins).padStart(2, "0")} ${period}`;
}

// "May 24 – 30" / "Jun 28 – Jul 4" — the month repeats only when the week
// straddles two of them.
export function formatWeekRange(weekStartUtc: Date, tz: string): string {
  const endUtc = new Date(weekStartUtc.getTime() + 6 * 86_400_000);
  const month = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { month: "short", timeZone: tz }).format(d);
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: tz }).format(d);
  const sameMonth = month(weekStartUtc) === month(endUtc);
  return sameMonth
    ? `${month(weekStartUtc)} ${day(weekStartUtc)} – ${day(endUtc)}`
    : `${month(weekStartUtc)} ${day(weekStartUtc)} – ${month(endUtc)} ${day(endUtc)}`;
}

function formatHour(h: number) {
  if (h === 12) return "12 PM";
  if (h === 0) return "12 AM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}