import React, { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useFetcher } from "react-router";
import { Building2, Wifi } from "lucide-react";
import { Tooltip } from "~/components/ui/floating";
import { Checkbox } from "~/components/ui/Checkbox";
import { RsvpButtons } from "~/components/RsvpButtons";
import { cn } from "~/lib/cn";
import { getZonedHourFraction, getZonedYMD } from "~/lib/timezone";
import { isPayPeriodEnd } from "~/lib/pay-period";
import type { EventBlock, EventAttendeeDTO, EventLinkDTO, WhDay } from "~/calendar/lib/types";
import {
  HOURS, HOUR_PX, INITIAL_SCROLL_HOUR, SUBDIVISIONS_PER_HOUR, SNAP_HOURS,
  RSVP_BADGE, DAY_KEYS, ATTENDEE_DOT, GUESTS_COLLAPSED, STRIPE_STYLE,
  formatHour, formatHourMinute, readableTextColor,
} from "~/calendar/lib/event-block";

export function useRefreshOnFocus(refresh: () => void) {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
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

export function EventGuestList({ attendees }: { attendees: EventAttendeeDTO[] }) {
  const [expanded, setExpanded] = useState(false);
  const accepted = attendees.filter((a) => a.status === "Accepted").length;
  const declined = attendees.filter((a) => a.status === "Declined").length;
  const pending = attendees.filter((a) => a.status === "Pending").length;
  const shown = expanded ? attendees : attendees.slice(0, GUESTS_COLLAPSED);
  const summary = [
    `${accepted} accepted`,
    declined > 0 ? `${declined} declined` : null,
    pending > 0 ? `${pending} awaiting` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mt-2">
      <div className="uppercase tracking-wide text-[10px] text-muted-foreground mb-0.5">
        {attendees.length} {attendees.length === 1 ? "guest" : "guests"}
      </div>
      <div className="text-[10px] text-muted-foreground mb-1">{summary}</div>
      <ul className="space-y-0.5">
        {shown.map((a, i) => (
          <li key={`${a.name}-${i}`} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${ATTENDEE_DOT[a.status]}`} />
            <Tooltip content={a.name}>
              <span
                className={`truncate ${a.status === "Declined" ? "text-muted-foreground line-through" : "text-foreground"}`}
              >
                {a.name}
              </span>
            </Tooltip>
            {a.organizer && (
              <span className="shrink-0 text-[10px] text-muted-foreground">organizer</span>
            )}
            {a.optional && (
              <span className="shrink-0 text-[10px] text-muted-foreground">optional</span>
            )}
          </li>
        ))}
      </ul>
      {attendees.length > GUESTS_COLLAPSED && (
        <button
          type="button"
          onMouseDown={(ev) => ev.stopPropagation()}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] font-medium text-accent-coral hover:underline"
        >
          {expanded ? "Show fewer" : `Show all ${attendees.length}`}
        </button>
      )}
    </div>
  );
}

export function CalendarEventDetailPopover({
  anchorEl,
  title,
  timeRange,
  location,
  description,
  organizerName,
  attendees,
  links,
  onClose,
  footer,
}: {
  anchorEl: HTMLElement | null;
  title: string;
  timeRange: string;
  location?: string;
  description?: string;
  organizerName?: string;
  attendees?: EventAttendeeDTO[];
  links?: EventLinkDTO[];
  // When set, the popover is interactive (click-opened): a backdrop dismisses
  // it and Escape closes it. Hover popovers leave this undefined.
  onClose?: () => void;
  footer?: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!onClose) return;
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
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = a.right + gap;
      if (left + cw + margin > vw) left = a.left - gap - cw;
      left = Math.max(margin, Math.min(left, vw - cw - margin));
      let top = a.top + ch + margin <= vh ? a.top : vh - ch - margin;
      top = Math.max(margin, top);
      setPos((prev) =>
        prev && prev.left === left && prev.top === top ? prev : { left, top },
      );
    };
    place();
    const ro = new ResizeObserver(place);
    if (cardRef.current) ro.observe(cardRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorEl, title, timeRange, location, description, attendees, links]);

  if (typeof document === "undefined") return null;

  const measured = pos != null;
  let left = pos?.left ?? 0;
  let top = pos?.top ?? 0;
  if (!measured) {
    const a = anchorEl?.getBoundingClientRect();
    if (a) {
      const CARD_W = 288;
      const gap = 8;
      const margin = 8;
      left =
        a.right + gap + CARD_W + margin > window.innerWidth
          ? a.left - gap - CARD_W
          : a.right + gap;
      left = Math.max(margin, left);
      top = Math.max(margin, a.top);
    }
  }

  return createPortal(
    <>
      {onClose && (
        <div
          className="fixed inset-0 z-40"
          onMouseDown={onClose}
          onClick={(ev) => ev.stopPropagation()}
        />
      )}
      <div
        ref={cardRef}
        role={onClose ? "dialog" : undefined}
        aria-label={onClose ? title : undefined}
        // Rendered through a portal, but React events still bubble to the
        // calendar block that opened it — which would toggle the card shut on
        // every click inside it.
        onClick={(ev) => ev.stopPropagation()}
        onMouseDown={(ev) => ev.stopPropagation()}
        className="fixed z-50 w-80 max-h-[26rem] overflow-y-auto rounded-md shadow-lg p-3 text-xs"
        style={{
          left,
          top,
          visibility: measured ? "visible" : "hidden",
          backgroundColor: "var(--color-card)",
          color: "var(--color-foreground)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm text-foreground break-words">{title}</div>
            <div className="text-muted-foreground mt-0.5">{timeRange}</div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close event details"
              className="-mt-0.5 -mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        {organizerName && (
          <div className="mt-1.5 text-muted-foreground">Organized by {organizerName}</div>
        )}
        {location && (
          <div className="mt-2">
            <div className="uppercase tracking-wide text-[10px] text-muted-foreground mb-0.5">
              Location
            </div>
            <div className="text-foreground whitespace-pre-wrap break-words">{location}</div>
          </div>
        )}
        {links && links.length > 0 && (
          <div className="mt-2 flex flex-col items-start gap-1">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer noopener"
                onMouseDown={(ev) => ev.stopPropagation()}
                className="font-medium text-accent-coral hover:underline break-all"
              >
                {l.label} →
              </a>
            ))}
          </div>
        )}
        {attendees && attendees.length > 0 && (
          <EventGuestList attendees={attendees} />
        )}
        {description && (
          <div className="mt-2">
            <div className="uppercase tracking-wide text-[10px] text-muted-foreground mb-0.5">
              Description
            </div>
            <div className="text-foreground whitespace-pre-wrap break-words">{description}</div>
          </div>
        )}
        {footer}
      </div>
    </>,
    document.body,
  );
}

// Per-meeting toggles in the event detail popover: log the meeting on your own
// timesheet, and (Core only) flag it as a Core meeting. Both write through the
// calendar route action, so a success revalidates the loader and the Timesheet
// tab picks the entry up without a reload.
export function MeetingDetailToggles({ meeting }: { meeting: NonNullable<EventBlock["meeting"]> }) {
  const timesheetFetcher = useFetcher<{ error?: string }>();
  const coreFetcher = useFetcher<{ error?: string }>();

  // Revalidation lands a beat after the submission, so read the in-flight value
  // off formData — otherwise the box visibly snaps back before settling.
  const onTimesheet = timesheetFetcher.formData
    ? timesheetFetcher.formData.get("onTimesheet") === "true"
    : meeting.onTimesheet;
  const isCoreMeeting = coreFetcher.formData
    ? coreFetcher.formData.get("isCoreMeeting") === "true"
    : meeting.isCoreMeeting;

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
      <Checkbox
        checked={onTimesheet}
        disabled={timesheetFetcher.state !== "idle"}
        onChange={(ev) =>
          timesheetFetcher.submit(
            {
              intent: "toggle-meeting-time-entry",
              meetingId: meeting.meetingId,
              onTimesheet: String(ev.target.checked),
            },
            { method: "post" },
          )
        }
        label="Add to timesheet"
      />
      {timesheetFetcher.data?.error && (
        <p className="text-[11px] text-red-600">{timesheetFetcher.data.error}</p>
      )}
      {meeting.canMarkCoreMeeting && (
        <>
          <Checkbox
            checked={isCoreMeeting}
            disabled={coreFetcher.state !== "idle"}
            onChange={(ev) =>
              coreFetcher.submit(
                {
                  intent: "set-meeting-core",
                  meetingId: meeting.meetingId,
                  isCoreMeeting: String(ev.target.checked),
                },
                { method: "post" },
              )
            }
            label="Core meeting"
          />
          {coreFetcher.data?.error && (
            <p className="text-[11px] text-red-600">{coreFetcher.data.error}</p>
          )}
        </>
      )}
    </div>
  );
}

export function WeekGridEvent({ e }: { e: EventBlock }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  const bufferBefore = e.bufferBefore ?? 0;
  const bufferAfter = e.bufferAfter ?? 0;
  const totalHours = bufferBefore + e.duration + bufferAfter;
  const border = e.borderClassName ? `border-2 ${e.borderClassName}` : "";
  const bufferBg = e.bufferClassName ?? "";
  const bodyHeight = e.duration * HOUR_PX;
  const timeRange = `${formatHourMinute(e.startHour)} – ${formatHourMinute(e.startHour + e.duration)}`;
  const isMeeting = Boolean(e.meeting);
  // Every block that carries anything worth reading opens the same persistent
  // popover on click, Google-Calendar style — hover was no good once the card
  // grew links and a guest list you have to be able to reach with the pointer.
  // Blocks with their own onClick (Timesheet entries → edit popover) keep it.
  const hasDetails = Boolean(
    e.location || e.description || e.organizerName || e.attendees?.length || e.links?.length,
  );
  const opensDetail = !e.onClick && (isMeeting || hasDetails);
  const clickable = Boolean(e.onClick) || opensDetail;

  return (
    <div
      className={`absolute left-0 right-0 ${bufferBefore === 0 ? "rounded-t-md" : ""} ${
        bufferAfter === 0 ? "rounded-b-md" : ""
      } ${border} ${bufferBg} overflow-hidden ${clickable ? "cursor-pointer" : ""}`}
      style={{
        top: (e.startHour - bufferBefore - HOURS[0]) * HOUR_PX,
        height: totalHours * HOUR_PX,
      }}
      // Always swallow mousedown, even with no onClick. The day column starts
      // a drag-to-create on any mousedown that reaches it, and its mouseup
      // commits a selection even with zero movement — so without this, clicking
      // an existing block opens a bogus "New entry" popover on top of it.
      // Previously this was gated on `e.onClick`, which is why only the
      // clickable (Manual) blocks were protected.
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={opensDetail ? () => setDetailOpen((v) => !v) : e.onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (ev) => {
              if (ev.target !== ev.currentTarget) return;
              if (ev.key !== "Enter" && ev.key !== " ") return;
              ev.preventDefault();
              if (opensDetail) setDetailOpen((v) => !v);
              else e.onClick?.();
            }
          : undefined
      }
      aria-label={clickable ? `${e.label}, ${timeRange}` : undefined}
    >
      <div
        ref={setAnchorEl}
        className={`absolute left-0 right-0 ${bufferBefore === 0 ? "rounded-t-md" : ""} ${
          bufferAfter === 0 ? "rounded-b-md" : ""
        } px-1.5 py-1 text-xs font-semibold leading-tight overflow-hidden transition-shadow shadow-[inset_3px_0_0_0_rgba(0,0,0,0.18),0_1px_2px_-1px_rgba(0,0,0,0.15)] ${e.className} ${
          clickable
            ? "hover:ring-2 hover:ring-inset hover:ring-white/60 hover:shadow-[inset_3px_0_0_0_rgba(0,0,0,0.18),0_2px_5px_-1px_rgba(0,0,0,0.25)]"
            : ""
        }`}
        style={{
          top: bufferBefore * HOUR_PX,
          height: bodyHeight,
          ...(e.bgColor
            ? { backgroundColor: e.bgColor, color: readableTextColor(e.bgColor) }
            : {}),
        }}
      >
        {e.label && <span className="truncate block">{e.label}</span>}
        {bodyHeight >= 34 && (
          <span className="block truncate text-[10px] font-normal leading-tight opacity-75">
            {timeRange}
          </span>
        )}
        {isMeeting && e.meeting?.rsvp && bodyHeight >= 50 && (
          <span className="block truncate text-[10px] font-normal leading-tight opacity-90">
            {e.meeting.rsvp}
          </span>
        )}
        {bodyHeight >= 50 && e.location && !isMeeting && (
          <span className="block truncate text-[10px] font-normal leading-tight opacity-90">
            {e.location}
          </span>
        )}
      </div>
      {detailOpen && opensDetail && (
        <CalendarEventDetailPopover
          anchorEl={anchorEl}
          title={e.label}
          timeRange={timeRange}
          location={e.location}
          description={e.description}
          organizerName={e.organizerName}
          attendees={e.attendees}
          links={e.links}
          onClose={() => setDetailOpen(false)}
          footer={
            e.meeting ? (
              <div className="mt-2 border-t border-border pt-2" onMouseDown={(ev) => ev.stopPropagation()}>
                <div className="flex items-center gap-2">
                  <span className="uppercase tracking-wide text-[10px] text-muted-foreground">
                    Your RSVP
                  </span>
                  {e.meeting.rsvp ? (
                    <span
                      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded ${RSVP_BADGE[e.meeting.rsvp]}`}
                    >
                      {e.meeting.rsvp}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">No response yet</span>
                  )}
                </div>
                <RsvpButtons
                  notificationId={e.meeting.notificationId}
                  onResponded={() => setDetailOpen(false)}
                />
                {e.meeting.notePageId && (
                  <Link
                    to={`/documents/${e.meeting.notePageId}`}
                    className="mt-2 inline-block text-[11px] font-medium text-accent-coral hover:underline"
                  >
                    Open meeting note →
                  </Link>
                )}
                <MeetingDetailToggles meeting={e.meeting} />
              </div>
            ) : null
          }
        />
      )}
    </div>
  );
}

export function WeekGrid({
  days,
  eventsByDay,
  backgroundLayer,
  overlayLayer,
  showProviderRow = false,
  onDayPointerSelect,
  selection,
  selectionPopover,
  onSelectionDismiss,
  onSelectionResize,
  showSubHourGrid = false,
  timezone,
  markPayPeriodEnds = false,
  fillAndScroll = false,
}: {
  days: { dayOfWeek: number; num: number; dateUtc: Date }[];
  eventsByDay: Record<number, EventBlock[]>;
  backgroundLayer?: (dayIdx: number) => React.ReactNode;
  overlayLayer?: (dayIdx: number) => React.ReactNode;
  showProviderRow?: boolean;
  onDayPointerSelect?: (dayIdx: number, startHour: number, endHour: number) => void;
  // A committed selection (controlled by the parent) drawn as a persistent
  // accent block. selectionPopover renders the editor in a viewport-clamped
  // portal; onSelectionDismiss fires when the user clicks the grid backdrop.
  // onSelectionResize fires while dragging the block's top/bottom handles.
  selection?: { dayIdx: number; startHour: number; endHour: number } | null;
  selectionPopover?: () => React.ReactNode;
  onSelectionDismiss?: () => void;
  onSelectionResize?: (startHour: number, endHour: number) => void;
  showSubHourGrid?: boolean;
  // When set, the column matching "today" in this timezone is highlighted and a
  // horizontal current-time line is drawn in it.
  timezone?: string;
  // Timesheet only: draw a boundary on the last day of each pay period, so it's
  // visible where hours stop accruing to one period and start on the next.
  // Availability has no payroll meaning, so it doesn't ask for this.
  markPayPeriodEnds?: boolean;
  // Fill the parent's bounded height and scroll internally (24h stays fully
  // reachable) instead of rendering a fixed 24h block clipped at midnight.
  // Also makes the day-header row + hour axis sticky. Availability opts in;
  // Schedule/Timesheet keep the page-flow layout.
  fillAndScroll?: boolean;
}) {
  // Current time, in this timezone, for the today-highlight + now-line. Both are
  // skipped until `now` is set (post-mount) and when no timezone is provided.
  const now = useNow();
  const todayIdx =
    timezone && now
      ? (() => {
          const ymd = getZonedYMD(now, timezone);
          return days.findIndex(
            (d) =>
              d.dateUtc.getUTCFullYear() === ymd.year &&
              d.dateUtc.getUTCMonth() + 1 === ymd.month &&
              d.dateUtc.getUTCDate() === ymd.day,
          );
        })()
      : -1;
  // Pixel offset of the now-line within a column body, or null when "now" falls
  // outside the visible hour window (line is hidden rather than pinned to an edge).
  const nowLineTop = (() => {
    if (!timezone || !now) return null;
    const frac = getZonedHourFraction(now, timezone);
    if (frac < HOURS[0] || frac >= HOURS[HOURS.length - 1] + 1) return null;
    return (frac - HOURS[0]) * HOUR_PX;
  })();
  // Drag-to-select state. We snap to 15-minute steps and clamp to the visible
  // hour range. dragAnchor is where mousedown happened; dragHover is where the
  // pointer currently is — both are stored as fractional hours.
  const [drag, setDrag] = useState<
    null | { dayIdx: number; anchor: number; hover: number }
  >(null);

  // Resize-drag state for the committed selection's top/bottom handles. `edge`
  // says which end is moving; `fixed` is the opposite end's hour (held still).
  const [resize, setResize] = useState<
    null | { edge: "start" | "end"; fixed: number }
  >(null);
  // Dragging the committed selection's body to move it whole (duration fixed).
  // `grabOffset` is how far into the block the pointer grabbed, so the block
  // tracks the cursor instead of snapping its top edge under it.
  const [move, setMove] = useState<null | { grabOffset: number; duration: number }>(null);

  // Column DOM refs so window-level mousemove can compute Y relative to the
  // column the drag started in, even when the cursor strays elsewhere.
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  // The committed selection block element, so the portal popover can anchor to
  // its real on-screen rect. A callback ref into state (not a plain useRef)
  // guarantees the portal re-renders the moment the node attaches — a shared
  // useRef read from a sibling left anchor stuck null.
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);

  const MIN_HOUR = HOURS[0];
  const MAX_HOUR = HOURS[HOURS.length - 1] + 1;

  // In fill-and-scroll mode the grid scrolls internally: keep the day-header row
  // and hour axis pinned, and open scrolled to the working-day start (once, so a
  // later user scroll isn't yanked back). Assigning scrollTop in the ref callback
  // runs on the client before paint — no midnight-then-jump flash, no SSR effect.
  const headerStickyCls = fillAndScroll ? "lg:sticky lg:top-0 lg:z-40" : "";
  const didInitScroll = useRef(false);
  const scrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (fillAndScroll && el && !didInitScroll.current) {
        el.scrollTop = INITIAL_SCROLL_HOUR * HOUR_PX;
        didInitScroll.current = true;
      }
    },
    [fillAndScroll],
  );

  const hourFromY = (offsetY: number): number => {
    const raw = MIN_HOUR + offsetY / HOUR_PX;
    const snapped = Math.round(raw / SNAP_HOURS) * SNAP_HOURS;
    return Math.max(MIN_HOUR, Math.min(MAX_HOUR, snapped));
  };

  const onDayMouseDown = (dayIdx: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onDayPointerSelect) return;
    if (e.button !== 0) return;
    // While a selection's editor is open, freeze the grid: a new drag would
    // move the committed selection out from under the open form. (The popover
    // itself lives in a body portal, so its clicks never reach a column — this
    // only guards clicks on the grid behind/around it.)
    if (selection) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const h = hourFromY(e.clientY - rect.top);
    setDrag({ dayIdx, anchor: h, hover: h });
    e.preventDefault();
  };

  // Window-level mousemove + mouseup so the drag keeps tracking even when the
  // cursor leaves the original column.
  useEffect(() => {
    if (!drag || !onDayPointerSelect) return;
    const col = columnRefs.current[drag.dayIdx];
    const onMove = (e: MouseEvent) => {
      if (!col) return;
      const rect = col.getBoundingClientRect();
      setDrag((prev) =>
        prev ? { ...prev, hover: hourFromY(e.clientY - rect.top) } : prev,
      );
    };
    const onUp = () => {
      const lo = Math.min(drag.anchor, drag.hover);
      const hi = Math.max(drag.anchor, drag.hover);
      const start = lo;
      const end = hi - lo < SNAP_HOURS ? Math.min(MAX_HOUR, lo + SNAP_HOURS * 2) : hi;
      onDayPointerSelect(drag.dayIdx, start, end);
      setDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, onDayPointerSelect, MAX_HOUR]);

  // Resizing the committed selection by dragging its top/bottom handle. The
  // moving edge follows the cursor (snapped, clamped, never crossing the fixed
  // edge); onSelectionResize streams the new range up so the popover form and
  // the block stay in sync live.
  const startResize = (edge: "start" | "end") => (e: React.MouseEvent) => {
    if (!selection || !onSelectionResize) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setResize({ edge, fixed: edge === "start" ? selection.endHour : selection.startHour });
  };

  useEffect(() => {
    if (!resize || !selection || !onSelectionResize) return;
    const col = columnRefs.current[selection.dayIdx];
    const onMove = (e: MouseEvent) => {
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const h = hourFromY(e.clientY - rect.top);
      // Keep at least one snap-step of height and don't let edges cross.
      if (resize.edge === "start") {
        const start = Math.min(h, resize.fixed - SNAP_HOURS);
        onSelectionResize(Math.max(MIN_HOUR, start), resize.fixed);
      } else {
        const end = Math.max(h, resize.fixed + SNAP_HOURS);
        onSelectionResize(resize.fixed, Math.min(MAX_HOUR, end));
      }
    };
    const onUp = () => setResize(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resize, selection, onSelectionResize, MIN_HOUR, MAX_HOUR]);

  // Moving the committed selection up/down as a whole. Duration is preserved:
  // the range slides, and is clamped so neither edge leaves the visible day
  // rather than being squashed at the boundary.
  const startMove = (e: React.MouseEvent) => {
    if (!selection || !onSelectionResize) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const col = columnRefs.current[selection.dayIdx];
    if (!col) return;
    const rect = col.getBoundingClientRect();
    const pointerHour = hourFromY(e.clientY - rect.top);
    setMove({
      grabOffset: pointerHour - selection.startHour,
      duration: selection.endHour - selection.startHour,
    });
  };

  useEffect(() => {
    if (!move || !selection || !onSelectionResize) return;
    const col = columnRefs.current[selection.dayIdx];
    const onMouseMove = (e: MouseEvent) => {
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const pointerHour = hourFromY(e.clientY - rect.top);
      const start = Math.min(
        Math.max(MIN_HOUR, pointerHour - move.grabOffset),
        MAX_HOUR - move.duration,
      );
      onSelectionResize(start, start + move.duration);
    };
    const onUp = () => setMove(null);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [move, selection, onSelectionResize, MIN_HOUR, MAX_HOUR]);

  return (
    <div className={`relative ${fillAndScroll ? "lg:flex lg:flex-col lg:flex-1 lg:min-h-0" : ""}`}>
    <div
      ref={scrollRef}
      className={`flex border border-border rounded-md overflow-hidden select-none ${
        // items-start: size the hour-axis + day columns to their full 24h
        // content height and scroll, instead of stretching (align-items:stretch)
        // them to the shorter viewport. Stretch clipped each column's box to the
        // visible height, so its border-r (and the axis's) faded out below the
        // fold while the absolutely-positioned grid lines kept going.
        fillAndScroll ? "lg:flex-1 lg:min-h-0 lg:items-start lg:overflow-y-auto lg:overflow-x-hidden" : ""
      }`}
    >
      {/* Hour axis */}
      <div className="flex flex-col w-14 border-r border-border bg-card text-[11px] text-muted-foreground">
        <div
          className={`shrink-0 bg-card border-b border-border ${showProviderRow ? "h-16" : "h-9"} ${headerStickyCls}`}
        />
        {HOURS.map((h) => (
          <div key={h} style={{ height: HOUR_PX }} className="shrink-0 px-2 pt-1 text-right">
            {formatHour(h)}
          </div>
        ))}
      </div>
      {/* Day columns */}
      {days.map((d, idx) => {
        const isToday = idx === todayIdx;
        const periodEnd = markPayPeriodEnds && isPayPeriodEnd(d.dateUtc);
        return (
        <div
          key={idx}
          className={`flex-1 min-w-0 border-r last:border-r-0 flex flex-col ${
            // A solid accent edge on the period's last column, rather than a
            // badge: the boundary is between this day and the next, so it wants
            // to be drawn on the seam.
            periodEnd ? "border-r-2 border-r-accent-teal" : "border-border"
          }`}
        >
          <div className={`shrink-0 flex flex-col items-center justify-center border-b border-border ${showProviderRow ? "h-16" : "h-9"} ${headerStickyCls} ${
            // Sticky headers need an opaque fill so scrolled rows don't bleed
            // through the faint today/period tint; today stays marked by its
            // coral date circle + now-line.
            fillAndScroll
              ? "bg-card"
              : isToday
                ? "bg-accent-coral/10"
                : periodEnd
                  ? "bg-accent-teal/10"
                  : ""
          }`}>
            <div className={`text-[10px] font-semibold tracking-wide ${isToday ? "text-accent-coral" : "text-muted-foreground"}`}>{DAY_KEYS[d.dayOfWeek]}</div>
            <div className={isToday ? "flex items-center justify-center w-6 h-6 rounded-full bg-accent-coral text-sm font-bold text-white" : "text-sm font-bold text-foreground"}>{d.num}</div>
            {periodEnd && !showProviderRow && (
              <Tooltip content="Last day of this pay period" placement="bottom">
                <span
                  className="text-[8px] font-semibold uppercase tracking-wide text-accent-teal leading-none"
                >
                  Pay ends
                </span>
              </Tooltip>
            )}
            {showProviderRow && (
              <div className="flex items-center gap-0.5 mt-0.5 text-muted-foreground/50">
                <Building2 className="w-2.5 h-2.5" />
                <Wifi className="w-2.5 h-2.5" />
              </div>
            )}
          </div>
          <div
            ref={(el) => {
              columnRefs.current[idx] = el;
            }}
            className={`relative shrink-0 ${onDayPointerSelect ? "cursor-crosshair" : ""}`}
            style={{ height: HOURS.length * HOUR_PX }}
            onMouseDown={onDayPointerSelect ? onDayMouseDown(idx) : undefined}
          >
            {HOURS.map((_, i) => (
              <Fragment key={i}>
                {/* Hour line — distinctly heavier (2px, darker) than the faint
                    10-minute sub-hour lines. */}
                <div
                  className="absolute left-0 right-0 border-t-2 border-foreground/45"
                  style={{ top: i * HOUR_PX }}
                />
                {showSubHourGrid &&
                  // 10-minute sub-hour lines (skip index 0; that's the hour line).
                  Array.from({ length: SUBDIVISIONS_PER_HOUR - 1 }).map((_, s) => (
                    <div
                      key={s}
                      className="absolute left-0 right-0 border-t border-foreground/[0.08]"
                      style={{ top: i * HOUR_PX + (HOUR_PX * (s + 1)) / SUBDIVISIONS_PER_HOUR }}
                    />
                  ))}
              </Fragment>
            ))}
            {backgroundLayer?.(idx)}
            {/* Redraw the grid lines above the availability tint so they stay
                visible over the colored background — but BEFORE events, so
                Busy blocks render on top of the lines (not the other way
                round). Hour lines bolder than the 10-minute sub-hour lines. */}
            {showSubHourGrid &&
              HOURS.map((_, i) => (
                <Fragment key={`grid-fg-${i}`}>
                  <div
                    className="absolute left-0 right-0 border-t-2 border-foreground/40 pointer-events-none"
                    style={{ top: i * HOUR_PX }}
                  />
                  {Array.from({ length: SUBDIVISIONS_PER_HOUR - 1 }).map((_, s) => (
                    <div
                      key={s}
                      className="absolute left-0 right-0 border-t border-foreground/[0.08] pointer-events-none"
                      style={{ top: i * HOUR_PX + (HOUR_PX * (s + 1)) / SUBDIVISIONS_PER_HOUR }}
                    />
                  ))}
                </Fragment>
              ))}
            {isToday && nowLineTop != null && (
              <div
                className="absolute left-0 right-0 h-0.5 bg-accent-coral pointer-events-none z-30"
                style={{ top: nowLineTop }}
                aria-label="Current time"
              >
                <div className="absolute left-0 -top-[3px] w-2 h-2 rounded-full bg-accent-coral" />
              </div>
            )}
            {drag && drag.dayIdx === idx && (() => {
              const lo = Math.min(drag.anchor, drag.hover);
              const hi = Math.max(drag.anchor, drag.hover);
              const heightHours = Math.max(SNAP_HOURS, hi - lo);
              const top = (lo - MIN_HOUR) * HOUR_PX;
              // Caption sits above the rectangle's top edge so a short (e.g.
              // 10-min) selection doesn't have the text spilling through the
              // box into the slot below. Near the grid's top there's no room
              // above (the column clips overflow), so drop it just inside.
              const captionBelow = top < 16;
              return (
                <div
                  className="absolute left-0 right-0 border-2 border-accent-coral bg-accent-coral/15 pointer-events-none rounded-sm z-30 shadow-md"
                  style={{ top, height: heightHours * HOUR_PX }}
                >
                  <div
                    className={`absolute left-0 px-1 py-0.5 rounded bg-white/75 text-[11px] font-semibold leading-none whitespace-nowrap text-accent-coral ${
                      captionBelow ? "top-1" : "bottom-full mb-1"
                    }`}
                  >
                    {formatHourMinute(lo)} – {formatHourMinute(hi)}
                  </div>
                </div>
              );
            })()}
            {/* Committed selection block — stays drawn where the drag landed,
                with top/bottom handles to resize it. The editor popover renders
                in a viewport-clamped portal (below), not clipped by the grid. */}
            {selection && selection.dayIdx === idx && (() => {
              const lo = selection.startHour;
              const hi = selection.endHour;
              const top = (lo - MIN_HOUR) * HOUR_PX;
              const height = Math.max(SNAP_HOURS, hi - lo) * HOUR_PX;
              const resizable = !!onSelectionResize;
              return (
                <div
                  ref={setAnchorEl}
                  // Body drag moves the whole block; the edge handles below
                  // resize it (they stopPropagation so they win over this).
                  onMouseDown={resizable ? startMove : undefined}
                  className={`absolute left-0 right-0 border-2 border-accent-coral bg-accent-coral/15 rounded-sm z-30 ${
                    resizable ? (move ? "cursor-grabbing" : "cursor-grab") : "pointer-events-none"
                  }`}
                  style={{ top, height }}
                >
                  {/* Caption above the top edge — see drag-preview note. */}
                  <div
                    className={`absolute left-0 px-1 py-0.5 rounded bg-white/75 text-[11px] font-semibold leading-none whitespace-nowrap text-accent-coral pointer-events-none ${
                      top < 16 ? "top-1" : "bottom-full mb-1"
                    }`}
                  >
                    {formatHourMinute(lo)} – {formatHourMinute(hi)}
                  </div>
                  {resizable && (
                    <>
                      {/* Top handle */}
                      <div
                        onMouseDown={startResize("start")}
                        className="absolute -top-1 left-0 right-0 h-2 cursor-ns-resize flex items-center justify-center group"
                        aria-label="Adjust start time"
                      >
                        <span className="w-8 h-1 rounded-full bg-accent-coral group-hover:h-1.5 transition-all" />
                      </div>
                      {/* Bottom handle */}
                      <div
                        onMouseDown={startResize("end")}
                        className="absolute -bottom-1 left-0 right-0 h-2 cursor-ns-resize flex items-center justify-center group"
                        aria-label="Adjust end time"
                      >
                        <span className="w-8 h-1 rounded-full bg-accent-coral group-hover:h-1.5 transition-all" />
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            {(eventsByDay[idx] ?? []).map((e, i) => (
              <WeekGridEvent key={i} e={e} />
            ))}
            {overlayLayer?.(idx)}
          </div>
        </div>
        );
      })}
    </div>
    {/* Editor popover — rendered in a portal at <body>, anchored to the
        selection block's real screen rect and clamped to the viewport, so it
        is never clipped by the grid's overflow or the screen edge. */}
    {selection && selectionPopover && (
      <SelectionPopoverPortal
        anchorEl={anchorEl}
        onDismiss={() => onSelectionDismiss?.()}
      >
        {selectionPopover()}
      </SelectionPopoverPortal>
    )}
    </div>
  );
}

// Floats the selection editor next to the committed block. Renders into <body>
// (so the grid's overflow-hidden can't clip it) and positions itself fixed,
// preferring the block's right side but flipping left / shifting up to stay
// fully on-screen. A transparent full-viewport backdrop captures outside clicks
// to dismiss — and, being in a portal, never lets a click reach a grid column.
export function SelectionPopoverPortal({
  anchorEl,
  onDismiss,
  children,
}: {
  anchorEl: HTMLElement | null;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Dismiss on a genuine outside click. We can't use a full-viewport backdrop
  // for this: the selection block (with its resize handles) lives in the grid
  // *under* this portal, so a covering backdrop would swallow handle mousedowns
  // and dismiss the selection the instant the user grabs a handle. Instead,
  // listen at the document and ignore mousedowns that land inside the popover
  // card or the anchored selection block (so resizing it works).
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      // The card's own dropdowns (Role, and any future Select/Menu/Popover)
      // render into their own portal at <body>, so they are not inside
      // cardRef — picking a role counted as an outside click and closed the
      // whole form. Anything in a floating layer belongs to the card.
      if (
        target instanceof Element
          ? target.closest("[data-floating-ui-portal]")
          : (target.parentElement as Element | null)?.closest("[data-floating-ui-portal]")
      ) {
        return;
      }
      onDismiss();
    };
    // Capture phase so we see the event even if something stops propagation.
    document.addEventListener("mousedown", onDocMouseDown, true);
    return () => document.removeEventListener("mousedown", onDocMouseDown, true);
  }, [anchorEl, onDismiss]);

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
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Prefer the right of the block; flip left if it would overflow.
      let left = a.right + gap;
      if (left + cw + margin > vw) left = a.left - gap - cw;
      left = Math.max(margin, Math.min(left, vw - cw - margin));
      // Vertically hug the block: top-align if the card fits below, else
      // bottom-align with the block (open upward) so it stays adjacent instead
      // of being yanked far up by a viewport clamp on a late-day selection.
      let top = a.top + ch + margin <= vh ? a.top : a.bottom - ch;
      top = Math.max(margin, Math.min(top, vh - ch - margin));
      setPos((prev) =>
        prev && prev.left === left && prev.top === top ? prev : { left, top },
      );
    };
    place();
    // Re-place when the card resizes (block→meeting grows it) or the window
    // reflows. Deps include anchorEl so this runs the instant the block mounts.
    const ro = new ResizeObserver(place);
    if (cardRef.current) ro.observe(cardRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorEl]);

  if (typeof document === "undefined") return null;

  // First paint (before the layout effect sets pos): derive a spot from the
  // anchor's current rect so the popover appears NEXT TO the block, flipping
  // left / opening upward near the edges. Falls back to centred if no anchor.
  let left = pos?.left;
  let top = pos?.top;
  if (left == null || top == null) {
    const a = anchorEl?.getBoundingClientRect();
    if (a) {
      const CARD_W = 320; // matches w-80
      const CARD_H = 416; // matches max-h-[26rem]
      const gap = 8;
      const margin = 8;
      left = a.right + gap + CARD_W + gap > window.innerWidth
        ? a.left - gap - CARD_W // would overflow right → flip to the left side
        : a.right + gap;
      left = Math.max(margin, left);
      const vh = window.innerHeight;
      const rawTop = a.top + CARD_H + margin <= vh ? a.top : a.bottom - CARD_H;
      top = Math.max(margin, Math.min(rawTop, vh - CARD_H - margin));
    } else {
      left = Math.max(8, window.innerWidth / 2 - 160);
      top = 80;
    }
  }

  return createPortal(
    // No covering backdrop: the card is positioned `fixed` on its own so it
    // doesn't sit over the grid's selection block, leaving the block's resize
    // handles clickable. Outside-click dismissal is handled by the document
    // listener above. The card still stops propagation so a click inside the
    // form can't bubble out to anything behind it.
    <div
      ref={cardRef}
      data-calendar-popover
      className="fixed z-50"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function DayBg({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`absolute inset-0 ${className ?? ""}`} style={style} />;
}

// Renders the striped "outside working hours" overlay for a single day column.
// Hours inside any working-hours segment are left blank (or washed). Used by
// both the AvailabilityWeekGrid and the schedule-preview's self-only mode.
export function workingHoursStripeLayer(
  workingHours: WhDay[],
  dow: number,
  options?: { enabled?: boolean },
): React.ReactNode {
  // When the Working Hours feature is off, the whole day is unrestricted — draw
  // no "outside hours" stripes at all.
  if (options?.enabled === false) return null;
  const wh = workingHours.find((w) => w.dayOfWeek === dow);
  if (!wh || wh.segments.length === 0) return <DayBg style={STRIPE_STYLE} />;
  const sorted = wh.segments
    .map((s) => ({ start: s.startMinute / 60, end: s.endMinute / 60 }))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end;
    } else {
      merged.push({ ...s });
    }
  }
  const dayStart = HOURS[0];
  const dayEnd = HOURS[HOURS.length - 1] + 1;
  const stripes: { startHour: number; duration: number }[] = [];
  let cursor = dayStart;
  for (const m of merged) {
    if (m.start > cursor) stripes.push({ startHour: cursor, duration: m.start - cursor });
    cursor = Math.max(cursor, m.end);
  }
  if (cursor < dayEnd) stripes.push({ startHour: cursor, duration: dayEnd - cursor });
  return (
    <>
      {stripes.map((s, i) => (
        <BlockBlock
          key={`stripe-${i}`}
          topHour={dayStart}
          startHour={s.startHour}
          duration={s.duration}
          style={STRIPE_STYLE}
        />
      ))}
    </>
  );
}

export function BlockBlock({
  topHour,
  startHour,
  duration,
  className,
  style,
}: {
  topHour: number;
  startHour: number;
  duration: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (duration <= 0) return null;
  return (
    <div
      className={`absolute left-0 right-0 ${className ?? ""}`}
      style={{
        top: (startHour - topHour) * HOUR_PX,
        height: duration * HOUR_PX,
        ...style,
      }}
    />
  );
}
