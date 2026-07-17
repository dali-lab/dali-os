import { useEffect, useMemo, useRef } from "react";

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
  // Sprints under this epic, ordered by startsAt. Each is its own bar row,
  // matching the reference timeline (one row per sprint, connectors between
  // consecutive sprints).
  sprints: TimelineSprint[];
};

// Bar fills. Epics are the parent rows, so they get a saturated coral
// gradient (the brand's heaviest accent) — distinctly bolder than their
// teal sprint children, which keeps the hierarchy obvious at a glance.
const EPIC_BAR: Record<EpicStatus, string> = {
  Backlog: "bg-muted-foreground/40",
  Open: "bg-gradient-to-b from-accent-coral to-accent-coral-light",
  InProgress: "bg-gradient-to-b from-accent-coral to-accent-coral-light",
  Done: "bg-accent-coral/45",
  Cancelled: "bg-destructive/50",
};

const SPRINT_BAR: Record<SprintStatus, string> = {
  Planned: "bg-muted-foreground/40",
  Active: "bg-gradient-to-b from-accent-teal to-accent-teal-light",
  Closed: "bg-accent-teal/45",
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

// Status pill — a small solid chip with a leading dot, sitting at the start
// of each bar (like the "Done" / "In progress" chips in the reference). Solid
// surface + white text so it stays legible on top of any bar fill, instead
// of the old gray-on-gray chip that disappeared on muted bars.
const EPIC_PILL: Record<EpicStatus, string> = {
  Backlog: "bg-card/90 text-muted-foreground ring-1 ring-black/5",
  Open: "bg-card/90 text-foreground ring-1 ring-black/5",
  InProgress: "bg-card/90 text-foreground ring-1 ring-black/5",
  Done: "bg-card/80 text-muted-foreground",
  Cancelled: "bg-card/80 text-destructive",
};

const SPRINT_PILL: Record<SprintStatus, string> = {
  Planned: "bg-card/90 text-muted-foreground ring-1 ring-black/5",
  Active: "bg-card/90 text-foreground ring-1 ring-black/5",
  Closed: "bg-card/80 text-muted-foreground",
};

// Dot color inside the pill — this is what carries the status hue now.
const EPIC_DOT: Record<EpicStatus, string> = {
  Backlog: "bg-muted-foreground",
  Open: "bg-accent-coral",
  InProgress: "bg-accent-coral",
  Done: "bg-muted-foreground",
  Cancelled: "bg-destructive",
};

const SPRINT_DOT: Record<SprintStatus, string> = {
  Planned: "bg-muted-foreground",
  Active: "bg-accent-teal",
  Closed: "bg-muted-foreground",
};

const DAY = 86_400_000;
const LABEL_W = 176; // px — fixed left column for row titles (w-44)
// Pixels per day. The axis scrolls horizontally rather than squashing, so a
// fixed scale keeps long projects readable.
const PX_PER_DAY = 22;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtMonth(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

type Row =
  | { kind: "epic"; epic: TimelineEpic }
  | { kind: "sprint"; sprint: TimelineSprint; epicId: string; prevId: string | null };

export function EpicsTimeline({ epics }: { epics: TimelineEpic[] }) {
  // Flatten epics → rows: an epic header row followed by one row per sprint.
  // `prevId` links a sprint to the one before it in the same epic so we can
  // draw a connector between them.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const epic of epics) {
      out.push({ kind: "epic", epic });
      let prevId: string | null = null;
      for (const sprint of epic.sprints) {
        out.push({ kind: "sprint", sprint, epicId: epic.id, prevId });
        prevId = sprint.id;
      }
    }
    return out;
  }, [epics]);

  // Global date window: the union of every scheduled epic/sprint span (and
  // today), then padded out by 3 months on each side and snapped to month
  // boundaries. The extra padding is empty grid you can scroll left/right
  // into, so the axis never dead-ends right at the data.
  const bounds = useMemo(() => {
    const times: number[] = [startOfDay(Date.now())];
    for (const e of epics) {
      if (e.startsAt) times.push(new Date(e.startsAt).getTime());
      if (e.endsAt) times.push(new Date(e.endsAt).getTime());
      for (const s of e.sprints) {
        times.push(new Date(s.startsAt).getTime());
        times.push(new Date(s.endsAt).getTime());
      }
    }
    if (times.length === 0) return null;

    // Snap to the 1st of (earliest month − 3) … 1st of (latest month + 4),
    // so the window starts/ends on clean month boundaries.
    const lo = new Date(Math.min(...times));
    const hi = new Date(Math.max(...times));
    const minD = new Date(lo.getFullYear(), lo.getMonth() - 3, 1);
    const maxD = new Date(hi.getFullYear(), hi.getMonth() + 4, 1);
    const min = startOfDay(minD.getTime());
    const max = startOfDay(maxD.getTime());
    const days = Math.max(Math.round((max - min) / DAY), 1);
    return { min, max, days, width: days * PX_PER_DAY };
  }, [epics]);

  // One tick per day for the gridlines; group ticks by month for the header.
  const days = useMemo(() => {
    if (!bounds) return [];
    const out: { t: number; isMonthStart: boolean; isToday: boolean }[] = [];
    const today = startOfDay(Date.now());
    for (let t = bounds.min; t <= bounds.max; t += DAY) {
      const d = new Date(t);
      out.push({
        t,
        isMonthStart: d.getDate() === 1,
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
      const start = days[i].t;
      let j = i;
      while (j + 1 < days.length && !days[j + 1].isMonthStart) j++;
      const end = days[j].t;
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
    return ((startOfDay(new Date(iso).getTime()) - bounds!.min) / DAY) * PX_PER_DAY;
  }
  function w(startIso: string, endIso: string): number {
    const a = startOfDay(new Date(startIso).getTime());
    const b = startOfDay(new Date(endIso).getTime());
    return Math.max(((b - a) / DAY + 1) * PX_PER_DAY, PX_PER_DAY);
  }

  if (epics.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic py-8 text-center border border-border rounded-lg bg-card">
        No epics yet.
      </div>
    );
  }

  const ROW_H = 48; // px per row, kept in sync with the row container height
  // Floor on visible rows so a short timeline still renders a tall, roomy
  // grid: any rows beyond the real data are empty gridline-only filler.
  const MIN_ROWS = 10;
  const fillerRows = Math.max(MIN_ROWS - rows.length, 0);
  const todayLeft =
    bounds && startOfDay(Date.now()) >= bounds.min && startOfDay(Date.now()) <= bounds.max
      ? ((startOfDay(Date.now()) - bounds.min) / DAY) * PX_PER_DAY
      : null;

  // The window now extends ~3 months of empty grid before the data, so on
  // mount jump the scroll to "today" (fallback: the first scheduled item),
  // sitting it a little in from the left edge rather than at column 0.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const initialScroll = useMemo(() => {
    if (!bounds) return 0;
    const anchor =
      todayLeft != null
        ? todayLeft
        : rows.length
          ? // earliest bar position across rows
            Math.min(
              ...rows.map((r) =>
                r.kind === "epic"
                  ? r.epic.startsAt
                    ? ((startOfDay(new Date(r.epic.startsAt).getTime()) - bounds.min) /
                        DAY) *
                      PX_PER_DAY
                    : Infinity
                  : ((startOfDay(new Date(r.sprint.startsAt).getTime()) - bounds.min) /
                      DAY) *
                    PX_PER_DAY,
              ),
            )
          : 0;
    return Math.max(Number.isFinite(anchor) ? anchor - 7 * PX_PER_DAY : 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds]);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollLeft = initialScroll;
    }
  }, [initialScroll]);

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div ref={scrollerRef} className="overflow-x-auto">
        <div style={{ width: bounds ? LABEL_W + bounds.width : "100%" }}>
          {/* Month + day header */}
          {bounds ? (
            <div className="sticky top-0 z-10 bg-card border-b border-border">
              <div className="flex">
                <div
                  className="flex-shrink-0 border-r border-border"
                  style={{ width: LABEL_W }}
                />
                <div className="relative" style={{ width: bounds.width, height: 44 }}>
                  {/* Month band */}
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
                  {/* Day numbers */}
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
                        {new Date(d.t).getDate()}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Rows */}
          <div className="relative">
            {/* Vertical gridlines + month boundaries, behind the bars */}
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

            {rows.map((row) => {
              if (row.kind === "epic") {
                const e = row.epic;
                const has = !!(e.startsAt && e.endsAt && bounds);
                return (
                  <div
                    key={`epic-${e.id}`}
                    className="relative flex items-center border-b border-border/40 bg-muted/10"
                    style={{ height: ROW_H }}
                  >
                    <div
                      className="flex-shrink-0 px-3 text-sm font-semibold text-foreground truncate border-r border-border"
                      style={{ width: LABEL_W }}
                      title={e.title}
                    >
                      {e.title}
                    </div>
                    <div
                      className="relative"
                      style={{ width: bounds ? bounds.width : "100%", height: ROW_H }}
                    >
                      {has ? (
                        <div
                          className={`absolute top-1/2 -translate-y-1/2 h-6 rounded-md shadow-sm ${EPIC_BAR[e.status]} flex items-center gap-1.5 px-1.5`}
                          style={{
                            left: x(e.startsAt!),
                            width: w(e.startsAt!, e.endsAt!),
                          }}
                          title={`${EPIC_LABEL[e.status]} · ${fmtDay(new Date(e.startsAt!))}–${fmtDay(new Date(e.endsAt!))}`}
                        >
                          <span
                            className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${EPIC_PILL[e.status]}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${EPIC_DOT[e.status]}`}
                            />
                            {EPIC_LABEL[e.status]}
                          </span>
                          <span className="text-[11px] font-medium text-white/95 truncate">
                            {e.sprintCount} sprint{e.sprintCount === 1 ? "" : "s"}
                          </span>
                        </div>
                      ) : (
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground italic">
                          No dates yet
                        </span>
                      )}
                    </div>
                  </div>
                );
              }

              // Sprint row
              const s = row.sprint;
              const left = x(s.startsAt);
              const width = w(s.startsAt, s.endsAt);
              return (
                <div
                  key={`sprint-${s.id}`}
                  className="relative flex items-center border-b border-border/30"
                  style={{ height: ROW_H }}
                >
                  <div
                    className="flex-shrink-0 pl-6 pr-3 text-[13px] text-muted-foreground truncate border-r border-border"
                    style={{ width: LABEL_W }}
                    title={s.name}
                  >
                    {s.name}
                  </div>
                  <div
                    className="relative"
                    style={{ width: bounds!.width, height: ROW_H }}
                  >
                    {/* Connector from the previous sprint's end (one row up)
                        into this bar's start — an elbow like the reference. */}
                    {row.prevId && (
                      <svg
                        className="absolute pointer-events-none overflow-visible"
                        style={{ left: 0, top: -ROW_H / 2, width: left, height: ROW_H }}
                        aria-hidden
                      >
                        <path
                          d={`M ${Math.max(left - 14, 0)} ${ROW_H / 2}
                              C ${left - 7} ${ROW_H / 2}, ${left - 7} ${ROW_H},
                                ${left} ${ROW_H}`}
                          fill="none"
                          className="stroke-muted-foreground/40"
                          strokeWidth={1.5}
                        />
                      </svg>
                    )}
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 h-[26px] rounded-md ${SPRINT_BAR[s.status]} flex items-center gap-1.5 px-1.5 shadow-sm`}
                      style={{ left, width }}
                      title={`${s.name} · ${SPRINT_LABEL[s.status]} · ${fmtDay(new Date(s.startsAt))}–${fmtDay(new Date(s.endsAt))}`}
                    >
                      <span
                        className={`truncate flex-1 min-w-0 text-[11px] ${
                          s.status === "Planned"
                            ? "text-foreground/80"
                            : "text-white/95 font-medium"
                        }`}
                      >
                        {s.name}
                      </span>
                      <span
                        className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${SPRINT_PILL[s.status]}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${SPRINT_DOT[s.status]}`}
                        />
                        {SPRINT_LABEL[s.status]}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Empty trailing rows: pure gridline background so a short
                timeline still has a tall, open grid to plan into. */}
            {Array.from({ length: fillerRows }).map((_, i) => (
              <div
                key={`filler-${i}`}
                className="relative flex items-center border-b border-border/20"
                style={{ height: ROW_H }}
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
