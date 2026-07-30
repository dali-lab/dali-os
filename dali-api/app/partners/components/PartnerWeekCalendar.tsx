import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { CalendarClock, ChevronLeft, ChevronRight, Flag, X } from "lucide-react";
import {
  APPLICATION_TZ,
  getZonedHourFraction,
  getZonedYMD,
  zonedDayStartUtc,
} from "~/lib/timezone";
import {
  DAY_KEYS,
  HOUR_PX,
  HOURS,
  formatHour,
  formatHourMinute,
  meetingBlockStyle,
  useNow,
  type MeetingRsvpValue,
} from "~/calendar/lib/week-grid";
import type { PartnerProjectViewData } from "~/partners/lib/partner-project-view.server";

type PartnerMeeting = PartnerProjectViewData["meetings"][number];
type PartnerMilestone = PartnerProjectViewData["milestones"][number];

const DAY_MS = 86_400_000;
// A placed chip never renders shorter than this, so a very short (or 0-minute)
// meeting is still clickable.
const MIN_CHIP_PX = 18;

type PlacedMeeting = {
  meeting: PartnerMeeting;
  dayIdx: number;
  startFrac: number;
  top: number;
  height: number;
};

// Read-only week calendar for the partner project hub. Renders the project's
// partner-visible meetings (already expanded to occurrences by the loader) on a
// Sun..Sat × hour grid in the lab timezone, plus a slim strip of sprint
// milestones above it. Paging is client-side over the already-loaded window.
export function PartnerWeekCalendar({
  meetings,
  milestones,
  pageHref,
  canRsvp = false,
}: {
  meetings: PartnerMeeting[];
  milestones: PartnerMilestone[];
  pageHref: (pageId: string) => string;
  canRsvp?: boolean;
}) {
  const now = useNow();
  // Reference "today": real clock after mount, else the initial render's date
  // (both land in the same week save for a sub-second week boundary).
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  // RSVP is owned here (keyed by meeting id) so the chip tint and the popover
  // controls stay in sync the moment a partner responds — no reload.
  const [rsvpById, setRsvpById] = useState<Record<string, MeetingRsvpValue>>(() => {
    const m: Record<string, MeetingRsvpValue> = {};
    for (const mt of meetings) m[mt.id] = mt.rsvp;
    return m;
  });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Open on the working day (~8am) rather than midnight.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 8 * HOUR_PX;
  }, []);

  const days = useMemo(() => buildDays(anchor), [anchor]);
  const weekStartMs = days[0].dateUtc.getTime();
  const weekEndMs = days[6].dateUtc.getTime() + DAY_MS;

  // Nav bounds: current week … the week containing now+60d (the server window).
  const nowRef = now ?? anchor;
  const currentWeekStartMs = buildDays(nowRef)[0].dateUtc.getTime();
  const maxWeekStartMs = buildDays(new Date(nowRef.getTime() + 60 * DAY_MS))[0].dateUtc.getTime();
  const canPrev = weekStartMs > currentWeekStartMs;
  const canNext = weekStartMs < maxWeekStartMs;
  const isCurrentWeek = weekStartMs === currentWeekStartMs;

  const dayIndexFor = (iso: string): number => {
    const d = new Date(iso);
    const ymd = getZonedYMD(d, APPLICATION_TZ);
    const midnight = zonedDayStartUtc(ymd.year, ymd.month, ymd.day, APPLICATION_TZ).getTime();
    return days.findIndex((day) => day.dateUtc.getTime() === midnight);
  };

  const placed = useMemo<PlacedMeeting[]>(() => {
    const out: PlacedMeeting[] = [];
    for (const meeting of meetings) {
      const dayIdx = dayIndexFor(meeting.start);
      if (dayIdx < 0) continue;
      const startFrac = getZonedHourFraction(new Date(meeting.start), APPLICATION_TZ);
      const top = (startFrac - HOURS[0]) * HOUR_PX;
      const height = Math.max(MIN_CHIP_PX, (meeting.durationMinutes / 60) * HOUR_PX);
      out.push({ meeting, dayIdx, startFrac, top, height });
    }
    // Earlier-starting chips first so a later overlapping one doesn't fully
    // cover an earlier one's top edge.
    return out.sort((a, b) => a.startFrac - b.startFrac);
  }, [meetings, days]);

  const meetingsByDay = useMemo(() => {
    const m: Record<number, PlacedMeeting[]> = {};
    for (const p of placed) (m[p.dayIdx] ??= []).push(p);
    return m;
  }, [placed]);

  const milestonesByDay = useMemo(() => {
    const m: Record<number, PartnerMilestone[]> = {};
    for (const mi of milestones) {
      const idx = dayIndexFor(mi.date);
      if (idx >= 0) (m[idx] ??= []).push(mi);
    }
    return m;
  }, [milestones, days]);

  const weekHasMilestones = Object.keys(milestonesByDay).length > 0;
  const weekIsEmpty = placed.length === 0 && !weekHasMilestones;
  const hasAnyData = meetings.length > 0 || milestones.length > 0;

  // Today column + now-line (both deferred until `now` is set post-mount).
  const todayIdx = now
    ? (() => {
        const ymd = getZonedYMD(now, APPLICATION_TZ);
        const midnight = zonedDayStartUtc(ymd.year, ymd.month, ymd.day, APPLICATION_TZ).getTime();
        return days.findIndex((d) => d.dateUtc.getTime() === midnight);
      })()
    : -1;
  const nowLineTop = (() => {
    if (!now || todayIdx < 0) return null;
    const frac = getZonedHourFraction(now, APPLICATION_TZ);
    if (frac < HOURS[0] || frac >= HOURS[HOURS.length - 1] + 1) return null;
    return (frac - HOURS[0]) * HOUR_PX;
  })();

  if (!hasAnyData) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground">
        No meetings scheduled yet.
      </div>
    );
  }

  const rangeLabel = `${days[0].dateUtc.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: APPLICATION_TZ,
  })} – ${days[6].dateUtc.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: APPLICATION_TZ,
  })}`;

  const openMeeting = openKey ? placed.find((p) => keyOf(p.meeting) === openKey)?.meeting ?? null : null;

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Week toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <div className="text-sm font-semibold text-foreground">{rangeLabel}</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAnchor(new Date())}
            disabled={isCurrentWeek}
            className="mr-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => setAnchor(new Date(weekStartMs - 12 * 3_600_000))}
            disabled={!canPrev}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => setAnchor(new Date(weekEndMs + 12 * 3_600_000))}
            disabled={!canNext}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Day headers (fixed above the scrolling grid) */}
      <div className="flex border-b border-border">
        <div className="w-14 flex-shrink-0" />
        {days.map((d, idx) => {
          const isToday = idx === todayIdx;
          return (
            <div
              key={idx}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center py-1.5 border-l border-border ${
                isToday ? "bg-accent-coral/10" : ""
              }`}
            >
              <div className={`text-[10px] font-semibold tracking-wide ${isToday ? "text-accent-coral" : "text-muted-foreground"}`}>
                {DAY_KEYS[idx]}
              </div>
              <div className={isToday ? "flex items-center justify-center w-6 h-6 rounded-full bg-accent-coral text-sm font-bold text-white" : "text-sm font-bold text-foreground"}>
                {d.num}
              </div>
            </div>
          );
        })}
      </div>

      {/* Milestone strip */}
      {weekHasMilestones && (
        <div className="flex border-b border-border bg-muted/30">
          <div className="w-14 flex-shrink-0 flex items-center justify-end pr-1.5">
            <Flag className="w-3 h-3 text-muted-foreground" />
          </div>
          {days.map((_, idx) => (
            <div key={idx} className="flex-1 min-w-0 border-l border-border px-1 py-1 space-y-1">
              {(milestonesByDay[idx] ?? []).map((mi) => (
                <div
                  key={mi.id}
                  title={mi.label}
                  className="truncate rounded bg-card border border-border px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                >
                  {mi.label}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Scrolling hour grid */}
      <div ref={scrollRef} className="relative max-h-[520px] overflow-y-auto">
        {weekIsEmpty && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center pt-24">
            <span className="rounded-full bg-card/90 border border-border px-3 py-1 text-xs text-muted-foreground shadow-sm">
              No meetings this week
            </span>
          </div>
        )}
        <div className="flex select-none">
          {/* Hour axis */}
          <div className="w-14 flex-shrink-0 text-[11px] text-muted-foreground">
            {HOURS.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="px-2 pt-1 text-right">
                {formatHour(h)}
              </div>
            ))}
          </div>
          {/* Day columns */}
          {days.map((_, idx) => {
            const isToday = idx === todayIdx;
            return (
              <div
                key={idx}
                className={`relative flex-1 min-w-0 border-l border-border ${isToday ? "bg-accent-coral/[0.04]" : ""}`}
                style={{ height: HOURS.length * HOUR_PX }}
              >
                {HOURS.map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-border/60"
                    style={{ top: i * HOUR_PX }}
                  />
                ))}
                {isToday && nowLineTop != null && (
                  <div
                    className="absolute left-0 right-0 h-0.5 bg-accent-coral z-30 pointer-events-none"
                    style={{ top: nowLineTop }}
                    aria-label="Current time"
                  >
                    <div className="absolute left-0 -top-[3px] w-2 h-2 rounded-full bg-accent-coral" />
                  </div>
                )}
                {(meetingsByDay[idx] ?? []).map((p) => (
                  <MeetingChip
                    key={keyOf(p.meeting)}
                    placed={p}
                    rsvp={rsvpById[p.meeting.id] ?? null}
                    onOpen={(el) => {
                      setAnchorEl(el);
                      setOpenKey(keyOf(p.meeting));
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {openMeeting && (
        <MeetingPopover
          anchorEl={anchorEl}
          meeting={openMeeting}
          rsvp={rsvpById[openMeeting.id] ?? null}
          canRsvp={canRsvp}
          pageHref={pageHref}
          onRsvp={(v) => setRsvpById((m) => ({ ...m, [openMeeting.id]: v }))}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  );
}

// Stable key across a recurring series (id repeats; start disambiguates).
function keyOf(m: PartnerMeeting): string {
  return `${m.id}-${m.start}`;
}

function buildDays(anchor: Date): { num: number; dateUtc: Date }[] {
  // Sunday of the anchor's week, in the lab timezone.
  const ymd = getZonedYMD(anchor, APPLICATION_TZ);
  const refUtcMidnight = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  const sundayMs = refUtcMidnight.getTime() - refUtcMidnight.getUTCDay() * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => {
    // Land at midday to sidestep DST 23/25-hour days when resolving the date.
    const noon = new Date(sundayMs + i * DAY_MS + 12 * 3_600_000);
    const d = getZonedYMD(noon, APPLICATION_TZ);
    return { num: d.day, dateUtc: zonedDayStartUtc(d.year, d.month, d.day, APPLICATION_TZ) };
  });
}

function MeetingChip({
  placed,
  rsvp,
  onOpen,
}: {
  placed: PlacedMeeting;
  rsvp: MeetingRsvpValue;
  onOpen: (el: HTMLButtonElement) => void;
}) {
  const { className, borderClassName } = meetingBlockStyle(rsvp);
  const ref = useRef<HTMLButtonElement | null>(null);
  const endFrac = placed.startFrac + placed.meeting.durationMinutes / 60;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => ref.current && onOpen(ref.current)}
      className={`absolute left-0.5 right-0.5 rounded-md border-2 ${borderClassName} ${className} overflow-hidden px-1.5 py-0.5 text-left text-xs font-semibold leading-tight shadow-sm hover:ring-2 hover:ring-inset hover:ring-white/60`}
      style={{ top: placed.top, height: placed.height }}
    >
      <span className="block truncate">{placed.meeting.title}</span>
      {placed.height >= 32 && (
        <span className="block truncate text-[10px] font-normal opacity-75">
          {formatHourMinute(placed.startFrac)} – {formatHourMinute(endFrac)}
        </span>
      )}
      {rsvp && placed.height >= 48 && (
        <span className="block truncate text-[10px] font-normal opacity-90">{rsvp}</span>
      )}
    </button>
  );
}

function MeetingPopover({
  anchorEl,
  meeting,
  rsvp,
  canRsvp,
  pageHref,
  onRsvp,
  onClose,
}: {
  anchorEl: HTMLElement | null;
  meeting: PartnerMeeting;
  rsvp: MeetingRsvpValue;
  canRsvp: boolean;
  pageHref: (pageId: string) => string;
  onRsvp: (v: MeetingRsvpValue) => void;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const place = () => {
      const card = cardRef.current;
      if (!card) return;
      const a = anchorEl.getBoundingClientRect();
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const gap = 8;
      const margin = 8;
      let left = a.right + gap;
      if (left + cw + margin > window.innerWidth) left = a.left - gap - cw;
      left = Math.max(margin, Math.min(left, window.innerWidth - cw - margin));
      let top = a.top;
      if (top + ch + margin > window.innerHeight) top = window.innerHeight - ch - margin;
      top = Math.max(margin, top);
      setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorEl, canRsvp, rsvp]);

  if (typeof document === "undefined") return null;

  const start = new Date(meeting.start);
  const startFrac = getZonedHourFraction(start, APPLICATION_TZ);
  const dateLabel = start.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: APPLICATION_TZ,
  });
  const timeRange = `${formatHourMinute(startFrac)} – ${formatHourMinute(startFrac + meeting.durationMinutes / 60)}`;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        ref={cardRef}
        className="fixed z-50 w-72 max-h-96 overflow-y-auto rounded-lg border border-border bg-card p-3 text-xs shadow-lg"
        style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <CalendarClock className="w-4 h-4 text-accent-teal mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-foreground break-words">{meeting.title}</div>
              <div className="text-muted-foreground mt-0.5">
                {dateLabel} · {timeRange}
                {meeting.recurring ? " · repeats" : ""}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {meeting.attendees.length > 0 && (
          <div className="mt-2">
            <div className="uppercase tracking-wide text-[10px] text-muted-foreground mb-0.5">Attendees</div>
            <div className="text-foreground">{meeting.attendees.map((a) => a.name).join(", ")}</div>
          </div>
        )}

        <div className="mt-2 flex items-center gap-3 border-t border-border pt-2">
          {meeting.notePageId && (
            <Link to={pageHref(meeting.notePageId)} className="font-medium text-accent-coral hover:underline">
              Notes
            </Link>
          )}
          <a href={`/partner/meetings/${meeting.id}/ics`} className="text-muted-foreground hover:text-foreground">
            Add to calendar
          </a>
        </div>

        {canRsvp && (
          <div className="mt-2 border-t border-border pt-2">
            <div className="uppercase tracking-wide text-[10px] text-muted-foreground mb-1">Your RSVP</div>
            <MeetingRsvp meetingId={meeting.id} value={rsvp} onChange={onRsvp} />
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}

// Partner RSVP control — optimistic, posts to the portal RSVP endpoint and
// reports the new value up so the chip tint tracks it.
function MeetingRsvp({
  meetingId,
  value,
  onChange,
}: {
  meetingId: string;
  value: MeetingRsvpValue;
  onChange: (v: MeetingRsvpValue) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function respond(v: NonNullable<MeetingRsvpValue>) {
    setBusy(true);
    try {
      const res = await fetch(`/partner/meetings/${meetingId}/rsvp`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: v }),
      });
      if (res.ok) onChange(v);
    } finally {
      setBusy(false);
    }
  }
  const opt = (v: NonNullable<MeetingRsvpValue>, label: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => respond(v)}
      className={`px-2.5 py-1 rounded-full text-xs border transition disabled:opacity-50 ${
        value === v
          ? "bg-accent-teal/15 text-accent-teal border-accent-teal/40"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-2">
      {opt("Accepted", "Going")}
      {opt("Tentative", "Maybe")}
      {opt("Declined", "Can't make it")}
    </div>
  );
}
