import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DAY,
  dayOffset,
  daySpan,
  localTodayUtcDay,
  utcDayOf,
} from "../lib/timeline-days";

export type EpicStatus = "Backlog" | "Open" | "InProgress" | "Done" | "Cancelled";
export type SprintStatus = "Planned" | "Active" | "Closed";

export type TimelineSprint = {
  id: string;
  name: string;
  status: SprintStatus;
  startsAt: string;
  endsAt: string;
};

export type TimelineEpic = {
  id: string;
  title: string;
  status: EpicStatus;
  // Span derived from the epic's explicit dates, falling back to the min/max
  // of its sprint dates. Null when the epic has no scheduled sprints yet —
  // rendered as "unscheduled".
  startsAt: string | null;
  endsAt: string | null;
  sprintCount: number;
  // Sprints under this epic, ordered by startsAt. Drawn as thinner bars
  // directly under the epic bar on the same track.
  sprints: TimelineSprint[];
};

// Bar fills. Epics are the parent bars (coral / stronger fill so they stay
// readable above the quieter sprint stack); sprints are subordinate teal.
const EPIC_BAR: Record<EpicStatus, string> = {
  Backlog: "bg-muted-foreground/70 ring-1 ring-inset ring-border",
  Open: "bg-accent-coral",
  InProgress: "bg-accent-coral",
  Done: "bg-accent-coral/60",
  Cancelled: "bg-destructive/70",
};

const SPRINT_BAR: Record<SprintStatus, string> = {
  Planned: "bg-muted-foreground/50 ring-1 ring-inset ring-border/60",
  Active: "bg-accent-teal",
  Closed: "bg-accent-teal/55",
};

const EPIC_LABEL: Record<EpicStatus, string> = {
  Backlog: "Backlog",
  Open: "Open",
  InProgress: "In progress",
  Done: "Done",
  Cancelled: "Cancelled",
};

const SPRINT_LABEL: Record<SprintStatus, string> = {
  Planned: "Planned",
  Active: "In progress",
  Closed: "Done",
};

const EPIC_PILL: Record<EpicStatus, string> = {
  Backlog: "bg-card/90 text-muted-foreground ring-1 ring-black/5",
  Open: "bg-card/90 text-foreground ring-1 ring-black/5",
  InProgress: "bg-card/90 text-foreground ring-1 ring-black/5",
  Done: "bg-card/80 text-muted-foreground",
  Cancelled: "bg-card/80 text-destructive",
};

const EPIC_DOT: Record<EpicStatus, string> = {
  Backlog: "bg-muted-foreground",
  Open: "bg-accent-coral",
  InProgress: "bg-accent-coral",
  Done: "bg-muted-foreground",
  Cancelled: "bg-destructive",
};

const LABEL_W = 176; // px — fixed left column for row titles (w-44)
const PX_PER_DAY = 22;
const EPIC_BAR_H = 26;
const SPRINT_BAR_H = 14;
const BAR_GAP = 4;
const ROW_PAD_Y = 10;

// All timeline dates are UTC-midnight instants and every printed label is
// the UTC calendar date, so formatting pins timeZone: "UTC" — otherwise a
// US-timezone viewer sees "Jul 19" for a bar that occupies the Jul 20 column.
function fmtDay(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtMonth(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function rowHeight(sprintCount: number): number {
  // Epic bar + optional stack of sprint bars underneath.
  const sprintStack =
    sprintCount > 0 ? BAR_GAP + sprintCount * SPRINT_BAR_H + (sprintCount - 1) * 3 : 0;
  return ROW_PAD_Y * 2 + EPIC_BAR_H + sprintStack;
}

function TimelineBarHover({
  open,
  anchorEl,
  title,
  rows,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  title: string;
  rows: { label: string; value: string }[];
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
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
      let left = a.left + a.width / 2 - cw / 2;
      left = Math.max(margin, Math.min(left, vw - cw - margin));
      let top = a.bottom + gap;
      if (top + ch + margin > vh) top = a.top - gap - ch;
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
  }, [open, anchorEl, title]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      className="fixed z-50 w-64 max-w-[min(16rem,calc(100vw-1rem))] rounded-md border border-border bg-card shadow-lg p-2.5 text-xs pointer-events-none"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div className="font-heading font-semibold text-foreground leading-snug break-words">
        {title}
      </div>
      <dl className="mt-1.5 space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-2 justify-between">
            <dt className="text-muted-foreground flex-shrink-0">{r.label}</dt>
            <dd className="text-foreground text-right break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>,
    document.body,
  );
}

function HoverBar({
  className,
  style,
  title,
  rows,
  children,
}: {
  className: string;
  style: CSSProperties;
  title: string;
  rows: { label: string; value: string }[];
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <div
        ref={setAnchorEl}
        className={className}
        style={style}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </div>
      <TimelineBarHover open={open} anchorEl={anchorEl} title={title} rows={rows} />
    </>
  );
}

export function EpicsTimeline({
  epics,
  taskCounts,
}: {
  epics: TimelineEpic[];
  // Optional per-epic task progress keyed by epic id (Cancelled tasks
  // excluded), shown in the epic hover card.
  taskCounts?: Record<string, { done: number; total: number }>;
}) {
  const bounds = useMemo(() => {
    // All day math is in UTC days (see ../lib/timeline-days): dates arrive
    // as UTC-midnight instants, and the header/labels print UTC dates.
    const times: number[] = [localTodayUtcDay()];
    for (const e of epics) {
      if (e.startsAt) times.push(utcDayOf(e.startsAt));
      if (e.endsAt) times.push(utcDayOf(e.endsAt));
      for (const s of e.sprints) {
        times.push(utcDayOf(s.startsAt));
        times.push(utcDayOf(s.endsAt));
      }
    }
    if (times.length === 0) return null;

    const lo = new Date(Math.min(...times));
    const hi = new Date(Math.max(...times));
    // Pad to whole months on either side. Date.UTC handles month overflow
    // and already lands on a UTC midnight.
    const min = Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth() - 3, 1);
    const max = Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth() + 4, 1);
    const days = Math.max(Math.round((max - min) / DAY), 1);
    return { min, max, days, width: days * PX_PER_DAY };
  }, [epics]);

  const days = useMemo(() => {
    if (!bounds) return [];
    const out: { t: number; isMonthStart: boolean; isToday: boolean }[] = [];
    const today = localTodayUtcDay();
    // UTC days are uniformly DAY ms (no DST), so stepping by DAY stays on
    // exact UTC midnights.
    for (let t = bounds.min; t <= bounds.max; t += DAY) {
      const d = new Date(t);
      out.push({
        t,
        isMonthStart: d.getUTCDate() === 1,
        isToday: t === today,
      });
    }
    return out;
  }, [bounds]);

  const months = useMemo(() => {
    if (!bounds || days.length === 0) return [];
    const out: { label: string; left: number; width: number }[] = [];
    let i = 0;
    while (i < days.length) {
      const start = days[i]!.t;
      let j = i;
      while (j + 1 < days.length && !days[j + 1]!.isMonthStart) j++;
      const end = days[j]!.t;
      out.push({
        label: fmtMonth(new Date(start)),
        left: ((start - bounds.min) / DAY) * PX_PER_DAY,
        width: ((end - start) / DAY + 1) * PX_PER_DAY,
      });
      i = j + 1;
    }
    return out;
  }, [bounds, days]);

  function x(iso: string): number {
    return dayOffset(iso, bounds!.min) * PX_PER_DAY;
  }
  function w(startIso: string, endIso: string): number {
    return Math.max(daySpan(startIso, endIso) * PX_PER_DAY, PX_PER_DAY);
  }

  const MIN_ROWS = 8;
  const fillerRows = Math.max(MIN_ROWS - epics.length, 0);
  const FILLER_H = 48;
  const today = localTodayUtcDay();
  const todayLeft =
    bounds && today >= bounds.min && today <= bounds.max
      ? ((today - bounds.min) / DAY) * PX_PER_DAY
      : null;

  const scrollerRef = useRef<HTMLDivElement>(null);
  const initialScroll = useMemo(() => {
    if (!bounds) return 0;
    const anchors: number[] = [];
    if (todayLeft != null) anchors.push(todayLeft);
    for (const e of epics) {
      if (e.startsAt) {
        anchors.push(dayOffset(e.startsAt, bounds.min) * PX_PER_DAY);
      }
      for (const s of e.sprints) {
        anchors.push(dayOffset(s.startsAt, bounds.min) * PX_PER_DAY);
      }
    }
    const anchor = anchors.length ? Math.min(...anchors) : 0;
    return Math.max(anchor - 7 * PX_PER_DAY, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds]);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollLeft = initialScroll;
    }
  }, [initialScroll]);

  // Empty state is returned only AFTER every hook above has run. Bailing out
  // earlier (as this did) changes the hook count between renders, so adding a
  // project's first epic — 0 -> 1 — crashed the whole page with "Rendered more
  // hooks than during the previous render". The hooks above all handle the
  // empty case (bounds === null), so running them here is harmless.
  if (epics.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic py-8 text-center border border-border rounded-lg bg-card">
        No epics yet.
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div ref={scrollerRef} className="overflow-x-auto">
        <div style={{ width: bounds ? LABEL_W + bounds.width : "100%" }}>
          {bounds ? (
            <div className="sticky top-0 z-10 bg-card border-b border-border">
              <div className="flex">
                <div
                  className="flex-shrink-0 border-r border-border"
                  style={{ width: LABEL_W }}
                />
                <div className="relative" style={{ width: bounds.width, height: 44 }}>
                  <div className="relative h-6 border-b border-border/60">
                    {months.map((m) => (
                      <div
                        key={m.left}
                        className="absolute top-0 h-6 flex items-center px-2 text-xs font-medium text-foreground/80 border-r border-border/60 truncate"
                        style={{ left: m.left, width: m.width }}
                      >
                        {m.label}
                      </div>
                    ))}
                  </div>
                  <div className="relative h-[18px]">
                    {days.map((d) => (
                      <div
                        key={d.t}
                        className={`absolute top-0 h-[18px] flex items-center justify-center text-[10px] tabular-nums ${
                          d.isToday
                            ? "text-accent-coral font-semibold"
                            : "text-muted-foreground"
                        }`}
                        style={{
                          left: ((d.t - bounds.min) / DAY) * PX_PER_DAY,
                          width: PX_PER_DAY,
                        }}
                      >
                        {new Date(d.t).getUTCDate()}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="relative">
            {bounds && (
              <div
                className="absolute inset-y-0 pointer-events-none"
                style={{ left: LABEL_W, width: bounds.width }}
                aria-hidden
              >
                {days.map((d) => (
                  <div
                    key={d.t}
                    className={`absolute inset-y-0 border-l ${
                      d.isMonthStart ? "border-border/60" : "border-border/20"
                    }`}
                    style={{ left: ((d.t - bounds.min) / DAY) * PX_PER_DAY }}
                  />
                ))}
                {todayLeft != null && (
                  <div
                    className="absolute inset-y-0 w-px bg-accent-coral/70"
                    style={{ left: todayLeft }}
                  >
                    <div className="absolute -top-1 -left-[3px] h-1.5 w-1.5 rounded-full bg-accent-coral" />
                  </div>
                )}
              </div>
            )}

            {epics.map((e) => {
              const h = rowHeight(e.sprints.length);
              const has = !!(e.startsAt && e.endsAt && bounds);
              const epicDateRange =
                e.startsAt && e.endsAt
                  ? `${fmtDay(new Date(e.startsAt))}–${fmtDay(new Date(e.endsAt))}`
                  : "—";
              const counts = taskCounts?.[e.id];

              return (
                <div
                  key={e.id}
                  className="relative flex border-b border-border/40 bg-muted/10"
                  style={{ height: h }}
                >
                  <div
                    className="flex-shrink-0 px-3 flex flex-col justify-center gap-0.5 border-r border-border min-w-0"
                    style={{ width: LABEL_W }}
                  >
                    <div
                      className="text-sm font-semibold text-foreground truncate"
                      title={e.title}
                    >
                      {e.title}
                    </div>
                    {e.sprints.length > 0 && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        {e.sprints.length} sprint{e.sprints.length === 1 ? "" : "s"}
                      </div>
                    )}
                  </div>
                  <div
                    className="relative"
                    style={{ width: bounds ? bounds.width : "100%", height: h }}
                  >
                    {has ? (
                      <>
                        {/* Parent epic bar — solid coral so it stays visible
                            above the thinner sprint stack. */}
                        <HoverBar
                          className={`absolute rounded-md shadow-sm ${EPIC_BAR[e.status]} flex items-center gap-1.5 px-1.5 cursor-default min-w-[22px]`}
                          style={{
                            left: x(e.startsAt!),
                            width: w(e.startsAt!, e.endsAt!),
                            top: ROW_PAD_Y,
                            height: EPIC_BAR_H,
                          }}
                          title={e.title}
                          rows={[
                            { label: "Status", value: EPIC_LABEL[e.status] },
                            { label: "Dates", value: epicDateRange },
                            { label: "Sprints", value: String(e.sprintCount) },
                            ...(counts && counts.total > 0
                              ? [
                                  {
                                    label: "Tasks",
                                    value: `${counts.done}/${counts.total} done`,
                                  },
                                ]
                              : []),
                          ]}
                        >
                          <span
                            className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${EPIC_PILL[e.status]}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${EPIC_DOT[e.status]}`}
                            />
                            {EPIC_LABEL[e.status]}
                          </span>
                        </HoverBar>

                        {/* Subordinate sprint bars stacked under the epic bar */}
                        {e.sprints.map((s, i) => {
                          const top =
                            ROW_PAD_Y + EPIC_BAR_H + BAR_GAP + i * (SPRINT_BAR_H + 3);
                          return (
                            <HoverBar
                              key={s.id}
                              className={`absolute rounded-sm shadow-sm ${SPRINT_BAR[s.status]} cursor-default`}
                              style={{
                                left: x(s.startsAt),
                                width: w(s.startsAt, s.endsAt),
                                top,
                                height: SPRINT_BAR_H,
                              }}
                              title={s.name}
                              rows={[
                                { label: "Status", value: SPRINT_LABEL[s.status] },
                                {
                                  label: "Dates",
                                  value: `${fmtDay(new Date(s.startsAt))}–${fmtDay(new Date(s.endsAt))}`,
                                },
                              ]}
                            />
                          );
                        })}
                      </>
                    ) : (
                      <span
                        className="absolute left-2 text-[11px] text-muted-foreground italic"
                        style={{ top: ROW_PAD_Y + 4 }}
                      >
                        No dates yet
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {Array.from({ length: fillerRows }).map((_, i) => (
              <div
                key={`filler-${i}`}
                className="relative flex items-center border-b border-border/20"
                style={{ height: FILLER_H }}
                aria-hidden
              >
                <div
                  className="flex-shrink-0 border-r border-border"
                  style={{ width: LABEL_W }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
