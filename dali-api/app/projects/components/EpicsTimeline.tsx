import {
  useCallback,
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
  sprintBands as computeSprintBands,
  utcDayOf,
} from "../lib/timeline-days";

export type EpicStatus = "Backlog" | "Open" | "InProgress" | "Done" | "Cancelled";
export type SprintStatus = "Planned" | "Active" | "Closed";
export type StoryStatus = "Todo" | "InProgress" | "Done";
export type TaskStatus = "Todo" | "InProgress" | "Blocked" | "Done" | "Cancelled";

export type TimelineTask = {
  id: string;
  title: string;
  status: TaskStatus;
  // Always resolved server-side — a task with no dates of its own inherits
  // its story's span, so a task bar is never unplaceable.
  startsAt: string;
  endsAt: string;
  assignees: { id: string; name: string }[];
};

export type TimelineStory = {
  id: string;
  title: string;
  status: StoryStatus;
  // Resolved span (explicit dates → task union → parent epic), so a story bar
  // always has somewhere to sit inside its epic.
  startsAt: string;
  endsAt: string;
  tasks: TimelineTask[];
};

export type TimelineEpic = {
  id: string;
  title: string;
  status: EpicStatus;
  // Null when the epic has no dates and nothing underneath it to derive them
  // from — rendered as "unscheduled" rather than as a bar.
  startsAt: string | null;
  endsAt: string | null;
  // Sprints under this epic. Not drawn as bars any more — the sprint grid is
  // the header band — but still reported in the epic's hover card.
  sprintCount: number;
  // Stories under this epic, drawn as bars nested inside the epic bar.
  stories: TimelineStory[];
};

/** A term's span, used to anchor and label the fixed one-week sprint grid. */
export type TimelineTerm = { code: string; startsAt: string; endsAt: string };

export type StoryDependencyEdge = { storyId: string; dependsOnStoryId: string };

type Level = "epic" | "story" | "task";

// ── Geometry ────────────────────────────────────────────────────────────────
// Bars are absolutely positioned in px rather than snapped to a row grid: a
// story's height is driven by how many tasks it holds, so nothing quantizes
// cleanly. Heights are computed bottom-up (tasks → story → epic) in `layout`.
const PX_PER_DAY = 42;
const HEADER_ROW_H = 34;
const HEADER_ROWS = 3; // month, day number, sprint band
const BODY_TOP_PAD = 14; // clear gap below the sprint band before bars start
const BODY_BOTTOM_PAD = 20;

// Cap on the scroll box. Past this the body scrolls vertically inside the card
// rather than pushing the rest of the page down — a project with many
// overlapping epics can otherwise run to several thousand pixels. The floor
// keeps a usable strip of bars visible under the 102px header on short
// viewports, where 70vh alone would leave almost nothing.
const MAX_BODY_H = "clamp(360px, 70vh, 880px)";

const EPIC_TOP_PAD = 16;
const EPIC_BOTTOM_PAD = 12;
const EPIC_GAP = 40;
const EPIC_MIN_H = 64;
const STORY_TOP_PAD = 12;
const STORY_BOTTOM_PAD = 10;
const STORY_GAP = 12;
const STORY_MIN_H = 34;
const TASK_H = 24;
const TASK_GAP = 6;

// Each nesting level sits further inset so adjacent borders never collide.
const INSET_PER_LEVEL = 3;

// ── Palette ─────────────────────────────────────────────────────────────────
// One hue per level, held as raw hex because the bars mix border, translucent
// fill and label ink from the same value. All three are brand tokens
// (accent-coral / accent-teal / accent-pink) and hold their value in both
// themes, so the bars read the same light or dark.
const LEVEL_COLOR: Record<Level, string> = {
  epic: "#FF8B81",
  story: "#00ADAB",
  task: "#E68FBE",
};

const LEVEL_LABEL: Record<Level, string> = {
  epic: "Epic",
  story: "User story",
  task: "Task",
};

const LEVEL_PLURAL: Record<Level, string> = {
  epic: "Epics",
  story: "User stories",
  task: "Tasks",
};

const EPIC_STATUS_LABEL: Record<EpicStatus, string> = {
  Backlog: "Backlog",
  Open: "Open",
  InProgress: "In progress",
  Done: "Done",
  Cancelled: "Cancelled",
};

const STORY_STATUS_LABEL: Record<StoryStatus, string> = {
  Todo: "Not started",
  InProgress: "In progress",
  Done: "Done",
};

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  Todo: "Not started",
  InProgress: "In progress",
  Blocked: "Blocked",
  Done: "Done",
  Cancelled: "Cancelled",
};

// All timeline dates are UTC-midnight instants and every printed label is the
// UTC calendar date, so formatting pins timeZone: "UTC" — otherwise a
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

function isWeekend(t: number): boolean {
  const wd = new Date(t).getUTCDay();
  return wd === 0 || wd === 6;
}

function rangeLabel(startIso: string, endIso: string): string {
  return `${fmtDay(new Date(startIso))} – ${fmtDay(new Date(endIso))}`;
}

// ── Hover card ──────────────────────────────────────────────────────────────

function TimelineBarHover({
  open,
  anchorEl,
  kind,
  title,
  rows,
  assignees,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  kind: Level;
  title: string;
  rows: { label: string; value: string }[];
  assignees?: { id: string; name: string }[];
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
      className="fixed z-50 w-64 max-w-[min(16rem,calc(100vw-1rem))] rounded-lg border border-border bg-card shadow-lg p-3 text-xs pointer-events-none"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div
        className="text-[10px] font-semibold uppercase tracking-wider mb-1"
        style={{ color: LEVEL_COLOR[kind] }}
      >
        {LEVEL_LABEL[kind]}
      </div>
      <div className="font-heading font-semibold text-sm text-foreground leading-snug break-words">
        {title}
      </div>
      <dl className="mt-2 space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-2 justify-between">
            <dt className="text-muted-foreground flex-shrink-0">{r.label}</dt>
            <dd className="text-foreground text-right break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
      {assignees && assignees.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border flex items-center gap-2 flex-wrap">
          {assignees.map((a) => (
            <span key={a.id} className="flex items-center gap-1.5 text-foreground">
              <span
                className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-navy-deep"
                style={{ background: LEVEL_COLOR[kind] }}
              >
                {a.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)}
              </span>
              {a.name}
            </span>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

function HoverBar({
  className,
  style,
  kind,
  title,
  rows,
  assignees,
  children,
  onClick,
}: {
  className: string;
  style: CSSProperties;
  kind: Level;
  title: string;
  rows: { label: string; value: string }[];
  assignees?: { id: string; name: string }[];
  children?: ReactNode;
  // When set, the bar becomes a button that opens the matching detail view.
  onClick?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <div
        ref={setAnchorEl}
        className={`${className}${onClick ? " cursor-pointer" : ""}`}
        style={style}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        {...(onClick
          ? {
              role: "button" as const,
              tabIndex: 0,
              onClick,
              onKeyDown: (e: { key: string; preventDefault: () => void }) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick();
                }
              },
            }
          : {})}
      >
        {children}
      </div>
      <TimelineBarHover
        open={open}
        anchorEl={anchorEl}
        kind={kind}
        title={title}
        rows={rows}
        assignees={assignees}
      />
    </>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export function EpicsTimeline({
  epics,
  taskCounts,
  terms = [],
  storyDependencies = [],
  onEpicClick,
  onStoryClick,
  onTaskClick,
}: {
  epics: TimelineEpic[];
  // Optional per-epic task progress keyed by epic id (Cancelled tasks
  // excluded), shown in the epic hover card.
  taskCounts?: Record<string, { done: number; total: number }>;
  // Project terms, oldest first. Anchor and labels for the one-week sprint
  // grid; with none, the grid falls back to plain week-of labels.
  terms?: TimelineTerm[];
  // Directed "depends on" edges (storyId waits on dependsOnStoryId), drawn as
  // arrows between story bars. Edges whose endpoints aren't currently laid out
  // (epic scrolled out of view, or story level hidden) are skipped.
  storyDependencies?: StoryDependencyEdge[];
  onEpicClick?: (epicId: string) => void;
  onStoryClick?: (epicId: string, storyId: string) => void;
  onTaskClick?: (taskId: string) => void;
}) {
  const [visibleLevels, setVisibleLevels] = useState<Record<Level, boolean>>({
    epic: true,
    story: true,
    task: true,
  });

  const bounds = useMemo(() => {
    // All day math is in UTC days (see ../lib/timeline-days): dates arrive as
    // UTC-midnight instants, and the header/labels print UTC dates.
    const times: number[] = [localTodayUtcDay()];
    for (const e of epics) {
      if (e.startsAt) times.push(utcDayOf(e.startsAt));
      if (e.endsAt) times.push(utcDayOf(e.endsAt));
      for (const s of e.stories) {
        times.push(utcDayOf(s.startsAt));
        times.push(utcDayOf(s.endsAt));
        for (const t of s.tasks) {
          times.push(utcDayOf(t.startsAt));
          times.push(utcDayOf(t.endsAt));
        }
      }
    }
    if (times.length === 0) return null;

    const lo = new Date(Math.min(...times));
    const hi = new Date(Math.max(...times));
    // Pad by a month either side. Date.UTC handles month overflow and already
    // lands on a UTC midnight.
    const min = Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth() - 1, 1);
    const max = Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth() + 2, 1);
    const days = Math.max(Math.round((max - min) / DAY), 1);
    return { min, max, days, width: days * PX_PER_DAY };
  }, [epics]);

  const days = useMemo(() => {
    if (!bounds) return [];
    const out: { t: number; isMonthStart: boolean; isToday: boolean; weekend: boolean }[] =
      [];
    const today = localTodayUtcDay();
    // UTC days are uniformly DAY ms (no DST), so stepping by DAY stays on
    // exact UTC midnights.
    for (let t = bounds.min; t <= bounds.max; t += DAY) {
      const d = new Date(t);
      out.push({
        t,
        isMonthStart: d.getUTCDate() === 1,
        isToday: t === today,
        weekend: isWeekend(t),
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

  // Sprint bands: a fixed one-week grid anchored to the earliest term start.
  // The tiling/labelling math lives in timeline-days (and is unit-tested
  // there); this only turns each band into pixels.
  const sprintBands = useMemo(() => {
    if (!bounds) return [];
    return computeSprintBands(bounds.min, bounds.max, terms, fmtDay).map((b) => ({
      key: b.key,
      left: ((b.key - bounds.min) / DAY) * PX_PER_DAY,
      width: ((b.end - b.key) / DAY + 1) * PX_PER_DAY,
      label: b.label,
    }));
  }, [bounds, terms]);

  const today = localTodayUtcDay();
  const todayLeft =
    bounds && today >= bounds.min && today <= bounds.max
      ? ((today - bounds.min) / DAY) * PX_PER_DAY
      : null;

  // Only epics overlapping the visible day range are laid out, and they stack
  // from the top in start order — so scrolling sideways keeps the visible work
  // compact instead of leaving the viewport parked on empty rows.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ start: number; end: number }>({
    start: 0,
    end: Number.POSITIVE_INFINITY,
  });

  const measureView = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const start = el.scrollLeft / PX_PER_DAY;
    const end = (el.scrollLeft + el.clientWidth) / PX_PER_DAY;
    setView((prev) =>
      Math.abs(prev.start - start) < 0.5 && Math.abs(prev.end - end) < 0.5
        ? prev
        : { start, end },
    );
  }, []);

  // Layout pass: sizes bottom-up (tasks → story → epic), then places the
  // visible epics top-down. Also emits the story-bar rectangles the dependency
  // arrows are drawn between.
  const layout = useMemo(() => {
    const epicBars: {
      epic: TimelineEpic;
      left: number;
      width: number;
      top: number;
      height: number;
    }[] = [];
    const storyBars: {
      epicId: string;
      story: TimelineStory;
      left: number;
      width: number;
      top: number;
      height: number;
    }[] = [];
    const taskBars: {
      task: TimelineTask;
      left: number;
      width: number;
      top: number;
      height: number;
    }[] = [];
    const storyRects = new Map<string, { sx: number; ex: number; cy: number }>();

    if (!bounds) return { epicBars, storyBars, taskBars, storyRects, height: 0 };

    const left = (iso: string) => dayOffset(iso, bounds.min) * PX_PER_DAY;
    const width = (a: string, b: string) =>
      Math.max(daySpan(a, b) * PX_PER_DAY, PX_PER_DAY);

    const scheduled = epics.filter((e) => e.startsAt && e.endsAt);
    const visible = scheduled
      .filter((e) => {
        const s = dayOffset(e.startsAt!, bounds.min);
        const en = s + daySpan(e.startsAt!, e.endsAt!);
        return en > view.start && s < view.end;
      })
      .sort(
        (a, b) => dayOffset(a.startsAt!, bounds.min) - dayOffset(b.startsAt!, bounds.min),
      );

    // Sizes first — a story is as tall as its task stack, an epic as tall as
    // its story stack.
    const storyH = new Map<string, number>();
    const epicH = new Map<string, number>();
    for (const e of visible) {
      let sum = 0;
      for (const st of e.stories) {
        const n = st.tasks.length;
        const h =
          n > 0
            ? STORY_TOP_PAD + n * TASK_H + (n - 1) * TASK_GAP + STORY_BOTTOM_PAD
            : STORY_MIN_H;
        storyH.set(st.id, h);
        sum += h;
      }
      const n = e.stories.length;
      epicH.set(
        e.id,
        n > 0 ? EPIC_TOP_PAD + sum + (n - 1) * STORY_GAP + EPIC_BOTTOM_PAD : EPIC_MIN_H,
      );
    }

    let cursor = HEADER_ROWS * HEADER_ROW_H + BODY_TOP_PAD;
    for (const e of visible) {
      const eh = epicH.get(e.id)!;
      epicBars.push({
        epic: e,
        left: left(e.startsAt!),
        width: width(e.startsAt!, e.endsAt!),
        top: cursor,
        height: eh,
      });

      let storyTop = cursor + EPIC_TOP_PAD;
      for (const st of e.stories) {
        const sh = storyH.get(st.id)!;
        const sLeft = left(st.startsAt);
        const sWidth = width(st.startsAt, st.endsAt);
        storyBars.push({
          epicId: e.id,
          story: st,
          left: sLeft,
          width: sWidth,
          top: storyTop,
          height: sh,
        });
        storyRects.set(st.id, {
          sx: sLeft,
          ex: sLeft + sWidth,
          cy: storyTop + sh / 2,
        });

        let taskTop = storyTop + STORY_TOP_PAD;
        for (const t of st.tasks) {
          taskBars.push({
            task: t,
            left: left(t.startsAt),
            width: width(t.startsAt, t.endsAt),
            top: taskTop,
            height: TASK_H,
          });
          taskTop += TASK_H + TASK_GAP;
        }

        storyTop += sh + STORY_GAP;
      }

      cursor += eh + EPIC_GAP;
    }

    const height =
      visible.length > 0
        ? cursor - EPIC_GAP + BODY_BOTTOM_PAD
        : HEADER_ROWS * HEADER_ROW_H + BODY_TOP_PAD + 40;

    return { epicBars, storyBars, taskBars, storyRects, height };
  }, [epics, bounds, view]);

  // The scroll box only resizes once scrolling settles: resizing it mid-scroll
  // is what makes the horizontal scrollbar jump around under the cursor.
  const [committedHeight, setCommittedHeight] = useState(layout.height);
  useEffect(() => {
    const id = setTimeout(() => setCommittedHeight(layout.height), 150);
    return () => clearTimeout(id);
  }, [layout.height]);

  const initialScroll = useMemo(() => {
    if (!bounds) return 0;
    const anchors: number[] = [];
    if (todayLeft != null) anchors.push(todayLeft);
    for (const e of epics) {
      if (e.startsAt) anchors.push(dayOffset(e.startsAt, bounds.min) * PX_PER_DAY);
    }
    const anchor = anchors.length ? Math.min(...anchors) : 0;
    return Math.max(anchor - 3 * PX_PER_DAY, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds]);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollLeft = initialScroll;
    }
    measureView();
  }, [initialScroll, measureView]);

  // Re-measure when the box itself resizes (sidebar collapse, window resize),
  // not just on scroll — the visible day range depends on clientWidth.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measureView);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureView]);

  const ticking = useRef(false);
  function handleScroll() {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      measureView();
      ticking.current = false;
    });
  }

  // Empty state is returned only AFTER every hook above has run. Bailing out
  // earlier changes the hook count between renders, so adding a project's
  // first epic — 0 -> 1 — would crash the page with "Rendered more hooks than
  // during the previous render".
  if (epics.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic py-8 text-center border border-border rounded-lg bg-card">
        No epics yet.
      </div>
    );
  }

  const unscheduled = epics.filter((e) => !e.startsAt || !e.endsAt);
  const gridHeight = Math.max(committedHeight, layout.height);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {(["epic", "story", "task"] as const).map((lvl) => {
          const on = visibleLevels[lvl];
          return (
            <button
              key={lvl}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setVisibleLevels((prev) => ({ ...prev, [lvl]: !prev[lvl] }))
              }
              className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-opacity ${
                on ? "text-foreground" : "border-border text-muted-foreground opacity-50"
              }`}
              style={
                on
                  ? {
                      borderColor: LEVEL_COLOR[lvl],
                      background: `color-mix(in srgb, ${LEVEL_COLOR[lvl]} 14%, transparent)`,
                    }
                  : undefined
              }
            >
              <span
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ background: LEVEL_COLOR[lvl] }}
              />
              {LEVEL_PLURAL[lvl]}
            </button>
          );
        })}
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        {/* Scrolls in both axes. Giving the box a vertical scrollport is also
            what finally makes the header's `sticky top-0` bite — until now its
            nearest scrollport was the page, so it never pinned. */}
        <div
          ref={scrollerRef}
          className="overflow-auto"
          style={{ maxHeight: MAX_BODY_H }}
          onScroll={handleScroll}
        >
          <div
            className="relative"
            style={{ width: bounds ? bounds.width : "100%", height: gridHeight }}
          >
            {bounds && (
              <>
                {/* Day columns + weekend shading, behind everything. */}
                <div className="absolute inset-0 pointer-events-none" aria-hidden>
                  {days.map((d) => (
                    <div
                      key={d.t}
                      className={`absolute inset-y-0 border-l ${
                        d.isMonthStart ? "border-border/60" : "border-border/20"
                      } ${d.weekend ? "bg-muted/25" : ""}`}
                      style={{
                        left: ((d.t - bounds.min) / DAY) * PX_PER_DAY,
                        width: PX_PER_DAY,
                      }}
                    />
                  ))}
                  {sprintBands.map((b) => (
                    <div
                      key={`div-${b.key}`}
                      className="absolute inset-y-0 border-l-2 border-accent-teal/40"
                      style={{ left: b.left }}
                    />
                  ))}
                  {todayLeft != null && (
                    <div
                      className="absolute inset-y-0 w-px bg-accent-coral/70"
                      style={{ left: todayLeft }}
                    />
                  )}
                </div>

                {/* Sticky three-row header: month / day / sprint band. */}
                <div
                  className="sticky top-0 z-30"
                  style={{ height: HEADER_ROWS * HEADER_ROW_H }}
                >
                  <div
                    className="relative bg-card border-b border-border"
                    style={{ height: HEADER_ROW_H }}
                  >
                    {months.map((m) => (
                      <div
                        key={m.left}
                        className="absolute top-0 flex items-center pl-2.5 text-[13px] font-bold text-foreground border-r border-border truncate"
                        style={{ left: m.left, width: m.width, height: HEADER_ROW_H }}
                      >
                        {m.label}
                      </div>
                    ))}
                  </div>

                  <div
                    className="relative bg-card border-b border-border"
                    style={{ height: HEADER_ROW_H }}
                  >
                    {days.map((d) => (
                      <div
                        key={d.t}
                        className={`absolute top-0 flex items-center justify-center text-[11px] tabular-nums border-r border-border/60 ${
                          d.weekend ? "bg-muted/40" : ""
                        } ${
                          d.isToday
                            ? "text-accent-coral font-semibold"
                            : "text-muted-foreground"
                        }`}
                        style={{
                          left: ((d.t - bounds.min) / DAY) * PX_PER_DAY,
                          width: PX_PER_DAY,
                          height: HEADER_ROW_H,
                        }}
                      >
                        {new Date(d.t).getUTCDate()}
                      </div>
                    ))}
                  </div>

                  <div
                    className="relative bg-card"
                    style={{ height: HEADER_ROW_H }}
                  >
                    {sprintBands.map((b, i) => (
                      <div
                        key={b.key}
                        className={`absolute top-0 flex items-center border-r-2 border-b border-accent-teal/40 text-[11px] font-semibold tracking-wide text-accent-teal ${
                          i % 2 === 1 ? "bg-accent-teal/5" : "bg-accent-teal/10"
                        }`}
                        style={{ left: b.left, width: b.width, height: HEADER_ROW_H }}
                      >
                        {/* Sticks to the left edge of the scroll box so a
                            part-scrolled band keeps its label on screen. */}
                        <span className="sticky left-3 whitespace-nowrap">
                          {b.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dependency arrows between story bars. z-20 lifts them above
                    the bars, pointer-events-none keeps the bars clickable. A
                    backward edge (dependent starts before its blocker ends)
                    still draws — the bezier simply loops leftward. */}
                {visibleLevels.story && storyDependencies.length > 0 && (
                  <svg
                    className="pointer-events-none absolute inset-0 z-20 overflow-visible"
                    width={bounds.width}
                    height={gridHeight}
                    aria-hidden
                  >
                    <defs>
                      <marker
                        id="story-dep-arrow"
                        viewBox="0 0 8 8"
                        refX="6.5"
                        refY="4"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto"
                      >
                        <path d="M0,0 L8,4 L0,8 z" fill={LEVEL_COLOR.story} />
                      </marker>
                    </defs>
                    {storyDependencies.map((d) => {
                      const from = layout.storyRects.get(d.dependsOnStoryId);
                      const to = layout.storyRects.get(d.storyId);
                      if (!from || !to) return null;
                      const x1 = from.ex;
                      const y1 = from.cy;
                      const x2 = to.sx;
                      const y2 = to.cy;
                      const dx = Math.max(18, Math.abs(x2 - x1) / 2);
                      return (
                        <path
                          key={`${d.dependsOnStoryId}->${d.storyId}`}
                          d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                          fill="none"
                          stroke={LEVEL_COLOR.story}
                          strokeWidth={1.5}
                          strokeOpacity={0.9}
                          markerEnd="url(#story-dep-arrow)"
                        />
                      );
                    })}
                  </svg>
                )}

                {/* Bars, outermost first so nested levels paint on top. */}
                {visibleLevels.epic &&
                  layout.epicBars.map((b) => {
                    const counts = taskCounts?.[b.epic.id];
                    return (
                      <HoverBar
                        key={b.epic.id}
                        kind="epic"
                        className="absolute rounded-lg z-10"
                        style={{
                          left: b.left + INSET_PER_LEVEL,
                          width: Math.max(b.width - INSET_PER_LEVEL * 2, PX_PER_DAY / 2),
                          top: b.top,
                          height: b.height,
                          border: `1.5px solid ${LEVEL_COLOR.epic}`,
                          background: `color-mix(in srgb, ${LEVEL_COLOR.epic} 7%, transparent)`,
                        }}
                        title={b.epic.title}
                        rows={[
                          { label: "Status", value: EPIC_STATUS_LABEL[b.epic.status] },
                          {
                            label: "Dates",
                            value: rangeLabel(b.epic.startsAt!, b.epic.endsAt!),
                          },
                          {
                            label: "Stories",
                            value: String(b.epic.stories.length),
                          },
                          { label: "Sprints", value: String(b.epic.sprintCount) },
                          ...(counts
                            ? [
                                {
                                  label: "Tasks",
                                  value: `${counts.done}/${counts.total} done`,
                                },
                              ]
                            : []),
                        ]}
                        onClick={
                          onEpicClick ? () => onEpicClick(b.epic.id) : undefined
                        }
                      >
                        <span
                          className="absolute -top-px left-2 -translate-y-1/2 bg-card px-1.5 text-[11px] font-bold whitespace-nowrap"
                          style={{ color: LEVEL_COLOR.epic }}
                        >
                          {b.epic.title}
                        </span>
                      </HoverBar>
                    );
                  })}

                {visibleLevels.story &&
                  layout.storyBars.map((b) => (
                    <HoverBar
                      key={b.story.id}
                      kind="story"
                      className="absolute rounded-lg z-10"
                      style={{
                        left: b.left + INSET_PER_LEVEL * 2,
                        width: Math.max(
                          b.width - INSET_PER_LEVEL * 4,
                          PX_PER_DAY / 2,
                        ),
                        top: b.top,
                        height: b.height,
                        border: `1.5px solid ${LEVEL_COLOR.story}`,
                        background: `color-mix(in srgb, ${LEVEL_COLOR.story} 8%, transparent)`,
                      }}
                      title={b.story.title}
                      rows={[
                        { label: "Status", value: STORY_STATUS_LABEL[b.story.status] },
                        {
                          label: "Dates",
                          value: rangeLabel(b.story.startsAt, b.story.endsAt),
                        },
                        { label: "Tasks", value: String(b.story.tasks.length) },
                      ]}
                      onClick={
                        onStoryClick
                          ? () => onStoryClick(b.epicId, b.story.id)
                          : undefined
                      }
                    >
                      <span
                        className="absolute -top-px left-2 -translate-y-1/2 bg-card px-1.5 text-[11px] font-bold whitespace-nowrap"
                        style={{ color: LEVEL_COLOR.story }}
                      >
                        {b.story.title}
                      </span>
                    </HoverBar>
                  ))}

                {visibleLevels.task &&
                  layout.taskBars.map((b) => (
                    <HoverBar
                      key={b.task.id}
                      kind="task"
                      className="absolute rounded-lg z-10 flex items-center overflow-hidden px-2"
                      style={{
                        left: b.left + INSET_PER_LEVEL * 3,
                        width: Math.max(
                          b.width - INSET_PER_LEVEL * 6,
                          PX_PER_DAY / 2,
                        ),
                        top: b.top,
                        height: b.height,
                        border: `1.5px solid ${LEVEL_COLOR.task}`,
                        background: `color-mix(in srgb, ${LEVEL_COLOR.task} 8%, transparent)`,
                      }}
                      title={b.task.title}
                      rows={[
                        { label: "Status", value: TASK_STATUS_LABEL[b.task.status] },
                        {
                          label: "Dates",
                          value: rangeLabel(b.task.startsAt, b.task.endsAt),
                        },
                      ]}
                      assignees={b.task.assignees}
                      onClick={onTaskClick ? () => onTaskClick(b.task.id) : undefined}
                    >
                      <span
                        className="text-[11px] font-bold truncate"
                        style={{ color: LEVEL_COLOR.task }}
                      >
                        {b.task.title}
                      </span>
                    </HoverBar>
                  ))}
              </>
            )}
          </div>
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Unscheduled:{" "}
          {unscheduled.map((e, i) => (
            <span key={e.id}>
              {i > 0 && ", "}
              {onEpicClick ? (
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() => onEpicClick(e.id)}
                >
                  {e.title}
                </button>
              ) : (
                e.title
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
