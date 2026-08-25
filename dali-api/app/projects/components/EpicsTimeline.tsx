import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight } from "lucide-react";
import {
  DAY,
  dayOffset,
  daySpan,
  localTodayUtcDay,
  sprintBands as computeSprintBands,
  utcDayOf,
} from "../lib/timeline-days";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { cn } from "~/lib/cn";

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
  description?: string | null;
  /** Quick-added by name and not yet filled in — draws the design's amber dot. */
  incomplete?: boolean;
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
  // Prose for the hover card. The design leads its popover with this — a bar's
  // title says which thing it is, this says what it's for.
  description?: string | null;
  status: EpicStatus;
  // Null when the epic has no dates and nothing underneath it to derive them
  // from — rendered as "unscheduled" rather than as a bar.
  startsAt: string | null;
  endsAt: string | null;
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

const EPIC_BOTTOM_PAD = 12;
const EPIC_GAP = 40;
const STORY_BOTTOM_PAD = 10;
const STORY_GAP = 12;
const TASK_H = 24;
const TASK_GAP = 6;

// How much room the group's own label eats before its children can start.
//
// The two shells seat the label differently, so this is not a constant. The
// classic label is notched into the top border (-translate-y-1/2), straddling
// it and costing the interior almost nothing. The design seats it as a filled
// pill *inside* the box — so the pad has to cover the pill's offset, its
// height, and a gap under it, or the first child is drawn straight through it.
//
// The numbers are the rendered pill, not an estimate: `top-1.5` (6px) plus a
// fixed `leading-4` line box (16px) plus the label's vertical padding, plus
// the design's own gap under the label. The labels below pin that leading
// precisely so this stays exact rather than riding on a font's default.
const EPIC_LABEL_PAD = 6 + (16 + 8) + 10; // top-1.5 + leading-4/py-1 + gap
const STORY_LABEL_PAD = 6 + (16 + 8) + 8; // top-1.5 + leading-4/py-1 + gap
const epicTopPad = (os: boolean) => (os ? EPIC_LABEL_PAD : 16);
const storyTopPad = (os: boolean) => (os ? STORY_LABEL_PAD : 12);
const epicMinH = (os: boolean) => (os ? EPIC_LABEL_PAD + EPIC_BOTTOM_PAD : 64);
const storyMinH = (os: boolean) => (os ? STORY_LABEL_PAD + STORY_BOTTOM_PAD : 34);

// Each nesting level sits further inset so adjacent borders never collide.
const INSET_PER_LEVEL = 3;

// Horizontal nesting. The classic inset is a hairline — just enough that two
// borders don't touch — which is why a child bar sits 3px inside its parent
// while the vertical pads give it 30-40px of room. That mismatch is what makes
// the rows read as cramped sideways. The design pads the group boxes instead
// (10px inside an epic, 8px inside a story), so a child clears its parent's
// edge, and two siblings on consecutive days clear each other.
//
// We place every bar straight on the day grid rather than inside a padded
// track, so that padding comes off the bar itself. `left` takes the full
// inset — bars for the same date have to line up down the column — and only
// the width gives, floored so a one-day bar can't inset itself to nothing.
const EPIC_PAD_X = 10;
const STORY_PAD_X = 8;
const MIN_BAR_W = 26;
const INSET_X: Record<Level, { os: number; classic: number }> = {
  epic: { os: INSET_PER_LEVEL, classic: INSET_PER_LEVEL },
  story: { os: INSET_PER_LEVEL + EPIC_PAD_X, classic: INSET_PER_LEVEL * 2 },
  task: { os: INSET_PER_LEVEL + EPIC_PAD_X + STORY_PAD_X, classic: INSET_PER_LEVEL * 3 },
};

/** Left offset and width for a bar at `level`, in the shell that's drawing it. */
function barX(level: Level, left: number, width: number, os: boolean) {
  const inset = os ? INSET_X[level].os : INSET_X[level].classic;
  return {
    left: left + inset,
    width: Math.max(width - inset * 2, os ? MIN_BAR_W : PX_PER_DAY / 2),
  };
}

// ── Palette ─────────────────────────────────────────────────────────────────
// One hue per level, held as raw hex because the bars mix border, translucent
// fill and label ink from the same value. All three are brand tokens
// (accent-coral / accent-teal / accent-pink) and hold their value in both
// themes, so the bars read the same light or dark.
export const LEVEL_COLOR: Record<Level, string> = {
  epic: "#FF8B81",
  story: "#00ADAB",
  task: "#E68FBE",
};

// The dali.os plates for the same three levels. The design colours a bar by
// filling it and printing light ink on top, rather than outlining it and
// tinting the label — so each level needs a fill/ink pair, not one hue. These
// are the design's own three (its modal type badges: epic purple, story teal,
// task maroon), which keeps the levels as far apart here as LEVEL_COLOR does.
// The level colours the shell declares, not a second copy of them: the badge
// and the bar label are styled from `--os-*-fill` in app.css, and light mode
// restates those variables once. Reading them here keeps a filter chip the same
// colour as the bar it filters in both modes.
export const OS_LEVEL: Record<Level, { fill: string; ink: string; edge: string }> = {
  epic: { fill: "var(--os-epic-fill)", ink: "var(--os-epic-ink)", edge: "var(--os-epic-edge)" },
  story: { fill: "var(--os-story-fill)", ink: "var(--os-story-ink)", edge: "var(--os-story-edge)" },
  task: { fill: "var(--os-task-fill)", ink: "var(--os-task-ink)", edge: "var(--os-task-edge)" },
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

/** Length of the popover's fade. Mirrors `.os-bar-popover` in app.css. */
const FADE_MS = 120;

function TimelineBarHover({
  open,
  anchorEl,
  kind,
  title,
  description,
  rows,
  assignees,
  clickable = false,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  kind: Level;
  title: string;
  // The item's own prose, shown under the title in the os popover. The design
  // leads with it — a bar's title is a label, this is what it's actually for.
  description?: string | null;
  rows: { label: string; value: string }[];
  assignees?: { id: string; name: string }[];
  // Whether the bar behind this card opens something on click. Drives the
  // redirect mark; the card itself is pointer-transparent (it follows a hover),
  // so the mark reads as "this bar opens" rather than being a second target.
  clickable?: boolean;
}) {
  const os = useFeatureFlag("os-redesign");
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // The card outlives `open` by the length of its fade, so it can animate out
  // as well as in — unmounting on mouseleave would cut the transition off at
  // the first frame. `shown` is the class the transition runs against.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    setShown(false);
    const id = setTimeout(() => setMounted(false), FADE_MS + 20);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    // One frame with the card at rest first, or there's nothing for the
    // browser to transition from and it simply appears.
    if (!open || !pos) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [open, pos]);

  useLayoutEffect(() => {
    if (!mounted || !anchorEl) {
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
      // The design hangs the card off the bar's left edge, where its label
      // is. Centring works for a short task bar but strands the card halfway
      // across the viewport from an epic that spans the whole screen.
      let left = os ? a.left : a.left + a.width / 2 - cw / 2;
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
  }, [mounted, anchorEl, title, os]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      className={cn(
        "pointer-events-none fixed z-50 max-w-[min(19rem,calc(100vw-1rem))] border border-border bg-card text-xs",
        os
          ? "w-[300px] rounded-2xl p-4 shadow-[0_12px_32px_var(--color-os-shadow)]"
          : "w-64 rounded-lg p-3 shadow-lg",
        // The design's .task-popover: it rises 4px into place as it fades.
        os && "os-bar-popover",
        os && shown && "os-bar-popover--shown",
      )}
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {os ? (
        // The design's popover: the title in the level's own ink with a
        // redirect mark beside it, the description in full, then one labelled
        // row per fact — stacked, each fenced off by a rule, rather than a
        // right-aligned definition list.
        <>
          <div className="mb-2.5 flex items-start justify-between gap-3">
            <div
              className="os-record-name text-[13px] font-bold leading-snug tracking-[0.24px] break-words"
              style={{ color: OS_LEVEL[kind].ink }}
            >
              {title}
            </div>
            {clickable && (
              <span
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-os-container text-os-accent"
                aria-hidden
                title="Click the bar to open"
              >
                <ArrowUpRight className="h-[15px] w-[15px]" />
              </span>
            )}
          </div>
          {description && (
            <p className="mb-4 text-sm leading-relaxed text-os-grey">{description}</p>
          )}
          <div className="flex flex-col">
            {rows.map((r) => (
              <div
                key={r.label}
                className="flex flex-col gap-1.5 border-t border-os-container pt-3 [&+&]:mt-3"
              >
                <span className="text-[11px] font-semibold uppercase tracking-widest text-os-grey">
                  {r.label}
                </span>
                <span className="text-sm break-words text-foreground">{r.value}</span>
              </div>
            ))}
            {assignees && assignees.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-os-container pt-3 [&+&]:mt-3">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-os-grey">
                  {assignees.length === 1 ? "Assignee" : "Assignees"}
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  {assignees.map((a) => (
                    <span key={a.id} className="flex items-center gap-2 text-sm text-foreground">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-os-container text-[9px] font-bold text-foreground">
                        {a.name.slice(0, 1).toUpperCase()}
                      </span>
                      {a.name}
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        </>
      ) : (
      <>
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
      </>
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
  description,
  rows,
  assignees,
  children,
  onClick,
  onDragStart,
  onResizeStart,
  draggable = false,
}: {
  className: string;
  style: CSSProperties;
  kind: Level;
  title: string;
  description?: string | null;
  rows: { label: string; value: string }[];
  assignees?: { id: string; name: string }[];
  children?: ReactNode;
  // When set, the bar becomes a button that opens the matching detail view.
  onClick?: () => void;
  // Edit mode only: begins a horizontal drag that reschedules the bar.
  onDragStart?: (e: ReactPointerEvent) => void;
  // Edit mode only: grips on the two ends, which move one date each.
  onResizeStart?: (edge: "start" | "end") => (e: ReactPointerEvent) => void;
  draggable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <div
        ref={setAnchorEl}
        className={cn(
          className,
          onClick && !draggable && "cursor-pointer",
          // The design's edit mode: bars become things you take hold of.
          draggable && "cursor-grab active:cursor-grabbing",
        )}
        style={style}
        onPointerDown={onDragStart}
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
        {/* Grips on the two ends: the middle of the bar moves the whole span,
            the ends adjust one date each. The hit area is a transparent 8px
            strip, but it draws a visible pill inside itself — an edge you can
            only find by hovering is an edge nobody finds. Faint at rest so a
            timeline in edit mode isn't a wall of handles, solid on hover. */}
        {draggable && onResizeStart && (
          <>
            {(["start", "end"] as const).map((edge) => (
              <span
                key={edge}
                className={cn(
                  "group/grip absolute inset-y-0 z-20 flex w-2 cursor-ew-resize items-center justify-center",
                  edge === "start" ? "left-0" : "right-0",
                )}
                onPointerDown={onResizeStart(edge)}
                aria-hidden
              >
                <span className="h-1/2 max-h-3 min-h-2 w-[3px] rounded-full bg-white/45 transition-colors group-hover/grip:bg-white" />
              </span>
            ))}
          </>
        )}
        {children}
      </div>
      <TimelineBarHover
        open={open}
        anchorEl={anchorEl}
        kind={kind}
        title={title}
        description={description}
        rows={rows}
        assignees={assignees}
        clickable={Boolean(onClick)}
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
  actions,
  editMode = false,
  onReschedule,
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
  // Rendered flush right on the level-toggle row, so the page's primary action
  // shares a line with the legend instead of taking a toolbar of its own.
  actions?: ReactNode;
  // The design's edit mode: bars can be dragged sideways to reschedule. Off,
  // the timeline is read-only apart from clicking through to a detail view.
  editMode?: boolean;
  // The caller owns persistence (and the revalidate that re-lays the bars out).
  // Called on drop with the whole-day shift the drag amounts to, and which
  // edge was held: "move" shifts the whole span, "start"/"end" move one end.
  onReschedule?: (
    kind: Level,
    id: string,
    deltaDays: number,
    edge: "move" | "start" | "end",
  ) => void;
  onEpicClick?: (epicId: string) => void;
  onStoryClick?: (epicId: string, storyId: string) => void;
  onTaskClick?: (taskId: string) => void;
}) {
  // The dali.os dress for the timeline: the design's filled bars and label
  // pills, its card shell, and its accent for "today". Layout, hit targets and
  // the level filter are untouched.
  const os = useFeatureFlag("os-redesign");

  /* Drag-to-reschedule. The bar's own transform follows the pointer so the
     gesture reads as direct manipulation, but only whole days are ever
     committed — the grid is a day grid, and a half-day shift isn't a thing a
     start date can be. `moved` gates the click that would otherwise open the
     detail modal the moment you let go. */
  type DragEdge = "move" | "start" | "end";
  const dragRef = useRef<{
    kind: Level;
    id: string;
    edge: DragEdge;
    startX: number;
    dx: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  // `dragActive` owns the window listeners; `dragTick` only forces the repaint
  // that moves the bar. Keeping them apart matters: subscribing on the tick
  // would tear down and re-add the pointermove listener on every pointermove.
  const [dragActive, setDragActive] = useState(false);
  const [dragTick, setDragTick] = useState(0);
  const dragging = dragRef.current;

  const beginDrag = useCallback(
    (kind: Level, id: string, edge: DragEdge = "move") =>
      (e: ReactPointerEvent) => {
        if (!editMode || !onReschedule) return;
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = { kind, id, edge, startX: e.clientX, dx: 0, moved: false };
        setDragActive(true);
      },
    [editMode, onReschedule],
  );

  useEffect(() => {
    if (!dragActive) return;
    const move = (e: globalThis.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.dx = e.clientX - d.startX;
      if (Math.abs(d.dx) > 3) d.moved = true;
      setDragTick((t) => t + 1);
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDragActive(false);
      if (!d) return;
      suppressClickRef.current = d.moved;
      const days = Math.round(d.dx / PX_PER_DAY);
      if (d.moved && days !== 0) onReschedule?.(d.kind, d.id, days, d.edge);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragActive, onReschedule]);

  // Wraps a bar's click so the pointerup that ends a drag doesn't also open
  // the detail modal. Consumes the flag, so a real click straight after works.
  const guardClick = useCallback((fn?: () => void) => {
    if (!fn) return undefined;
    return () => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      fn();
    };
  }, []);

  // The live offset for the bar currently under the pointer, snapped to the
  // day grid so what you see is what will be committed.
  const dragStyle = (kind: Level, id: string, width: number): CSSProperties => {
    if (!dragging || dragging.kind !== kind || dragging.id !== id) return {};
    const snapped = Math.round(dragging.dx / PX_PER_DAY) * PX_PER_DAY;
    const lift = { zIndex: 40, boxShadow: "0 10px 24px var(--color-os-shadow)" };
    // Resizing keeps the opposite edge pinned and never lets the bar collapse
    // past a single day — the commit below clamps the same way, so what you
    // drag is what you get.
    if (dragging.edge === "start") {
      const dx = Math.min(snapped, width - PX_PER_DAY);
      return { ...lift, transform: `translateX(${dx}px)`, width: width - dx };
    }
    if (dragging.edge === "end") {
      return { ...lift, width: Math.max(width + snapped, PX_PER_DAY) };
    }
    return { ...lift, transform: `translateX(${snapped}px)` };
  };

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
            ? storyTopPad(os) + n * TASK_H + (n - 1) * TASK_GAP + STORY_BOTTOM_PAD
            : storyMinH(os);
        storyH.set(st.id, h);
        sum += h;
      }
      const n = e.stories.length;
      epicH.set(
        e.id,
        n > 0
          ? epicTopPad(os) + sum + (n - 1) * STORY_GAP + EPIC_BOTTOM_PAD
          : epicMinH(os),
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

      let storyTop = cursor + epicTopPad(os);
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
        // Arrows land on the bar as drawn, not on the raw day geometry — the
        // nesting inset moves both its edges.
        const sx = barX("story", sLeft, sWidth, os);
        storyRects.set(st.id, {
          sx: sx.left,
          ex: sx.left + sx.width,
          cy: storyTop + sh / 2,
        });

        let taskTop = storyTop + storyTopPad(os);
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
  }, [epics, bounds, view, os]);

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
      <div className="flex flex-wrap items-center gap-2">
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
              className={cn(
                "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-opacity",
                on
                  ? os
                    ? "text-white"
                    : "text-foreground"
                  : os
                    ? "border-os-container bg-os-well text-os-grey opacity-60"
                    : "border-border text-muted-foreground opacity-50",
              )}
              style={
                on
                  ? os
                    ? { borderColor: OS_LEVEL[lvl].edge, background: OS_LEVEL[lvl].fill }
                    : {
                        borderColor: LEVEL_COLOR[lvl],
                        background: `color-mix(in srgb, ${LEVEL_COLOR[lvl]} 14%, transparent)`,
                      }
                  : undefined
              }
            >
              <span
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ background: os ? OS_LEVEL[lvl].ink : LEVEL_COLOR[lvl] }}
              />
              {LEVEL_PLURAL[lvl]}
            </button>
          );
        })}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>

      <div
        className={cn(
          "overflow-hidden border border-border bg-card",
          os ? "rounded-2xl" : "rounded-lg",
        )}
      >
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
            className={cn("relative", os && "bg-os-well")}
            style={{ width: bounds ? bounds.width : "100%", height: gridHeight }}
          >
            {bounds && (
              <>
                {/* Day columns + weekend shading, behind everything. */}
                <div className="absolute inset-0 pointer-events-none" aria-hidden>
                  {days.map((d) => (
                    <div
                      key={d.t}
                      className={cn(
                        "absolute inset-y-0",
                        d.isMonthStart
                          ? os
                            ? "border-l-2 border-os-accent/40"
                            : "border-l border-border/60"
                          : "border-l border-border/20",
                        d.weekend && "bg-muted/25",
                      )}
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
                        className={cn(
                          "absolute top-0 flex items-center pl-2.5 text-foreground border-r border-border truncate",
                          os ? "text-base font-medium" : "text-[13px] font-bold",
                        )}
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
                        className={cn(
                          "absolute top-0 flex items-center justify-center border-r border-border/60 tabular-nums",
                          os ? "text-[13px]" : "text-[11px]",
                          d.weekend && "bg-muted/40",
                          d.isToday
                            ? os
                              ? "text-foreground"
                              : "text-accent-coral font-semibold"
                            : "text-muted-foreground",
                        )}
                        style={{
                          left: ((d.t - bounds.min) / DAY) * PX_PER_DAY,
                          width: PX_PER_DAY,
                          height: HEADER_ROW_H,
                        }}
                      >
                        {/* The design rings today rather than recolouring the
                            numeral, so it stays legible against the band. */}
                        {os && d.isToday ? (
                          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-os-accent font-extrabold text-os-bg">
                            {new Date(d.t).getUTCDate()}
                          </span>
                        ) : (
                          new Date(d.t).getUTCDate()
                        )}
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
                        className={cn(
                          "absolute top-0 flex items-center border-b font-semibold tracking-wide",
                          os ? "text-sm" : "text-[11px]",
                          os
                            ? // The design alternates two solid bands with white
                              // ink instead of tinting one accent two ways.
                              cn(
                                "border-r border-os-hover-strong text-os-fg",
                                i % 2 === 1 ? "bg-os-sprint-b" : "bg-os-sprint-a",
                              )
                            : cn(
                                "border-r-2 border-accent-teal/40 text-accent-teal",
                                i % 2 === 1 ? "bg-accent-teal/5" : "bg-accent-teal/10",
                              ),
                        )}
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
                          ...barX("epic", b.left, b.width, os),
                          top: b.top,
                          height: b.height,
                          border: `1px solid ${os ? OS_LEVEL.epic.edge : LEVEL_COLOR.epic}`,
                          background: os
                            ? "transparent"
                            : `color-mix(in srgb, ${LEVEL_COLOR.epic} 7%, transparent)`,
                          ...dragStyle(
                            "epic",
                            b.epic.id,
                            barX("epic", b.left, b.width, os).width,
                          ),
                        }}
                        draggable={editMode && Boolean(onReschedule)}
                        onDragStart={beginDrag("epic", b.epic.id)}
                        onResizeStart={(edge) => beginDrag("epic", b.epic.id, edge)}
                        title={b.epic.title}
                        description={b.epic.description}
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
                          ...(counts
                            ? [
                                {
                                  label: "Tasks",
                                  value: `${counts.done}/${counts.total} done`,
                                },
                              ]
                            : []),
                        ]}
                        onClick={guardClick(
                          onEpicClick ? () => onEpicClick(b.epic.id) : undefined,
                        )}
                      >
                        {/* The design seats the label as a filled pill inside
                            the group's top-left rather than notching it into
                            the border, so it needs no bg-card to punch a hole. */}
                        <span
                          className={
                            os
                              ? "os-bar-label os-bar-label--epic absolute left-1.5 top-1.5 max-w-[calc(100%-12px)] truncate rounded-md px-3 py-1 text-[12px] leading-4 font-semibold tracking-[0.24px] whitespace-nowrap"
                              : "absolute -top-px left-2 -translate-y-1/2 bg-card px-1.5 text-[11px] font-bold whitespace-nowrap"
                          }
                          style={os ? undefined : { color: LEVEL_COLOR.epic }}
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
                        ...barX("story", b.left, b.width, os),
                        top: b.top,
                        height: b.height,
                        border: `1px solid ${os ? OS_LEVEL.story.edge : LEVEL_COLOR.story}`,
                        background: os
                          ? "transparent"
                          : `color-mix(in srgb, ${LEVEL_COLOR.story} 8%, transparent)`,
                        ...dragStyle(
                          "story",
                          b.story.id,
                          barX("story", b.left, b.width, os).width,
                        ),
                      }}
                      draggable={editMode && Boolean(onReschedule)}
                      onDragStart={beginDrag("story", b.story.id)}
                      onResizeStart={(edge) => beginDrag("story", b.story.id, edge)}
                      title={b.story.title}
                      description={b.story.description}
                      rows={[
                        { label: "Status", value: STORY_STATUS_LABEL[b.story.status] },
                        {
                          label: "Dates",
                          value: rangeLabel(b.story.startsAt, b.story.endsAt),
                        },
                        { label: "Tasks", value: String(b.story.tasks.length) },
                      ]}
                      onClick={guardClick(
                        onStoryClick
                          ? () => onStoryClick(b.epicId, b.story.id)
                          : undefined,
                      )}
                    >
                      <span
                        className={
                          os
                            ? "os-bar-label os-bar-label--story absolute left-1.5 top-1.5 flex max-w-[calc(100%-12px)] items-center rounded-md px-2.5 py-1 text-[11px] leading-4 font-semibold tracking-[0.2px] whitespace-nowrap"
                            : "absolute -top-px left-2 -translate-y-1/2 bg-card px-1.5 text-[11px] font-bold whitespace-nowrap"
                        }
                        style={os ? undefined : { color: LEVEL_COLOR.story }}
                      >
                        {os && b.story.incomplete && (
                          <span className="os-incomplete-dot mr-1.5 shrink-0">!</span>
                        )}
                        <span className="truncate">{b.story.title}</span>
                      </span>
                    </HoverBar>
                  ))}

                {visibleLevels.task &&
                  layout.taskBars.map((b) => (
                    <HoverBar
                      key={b.task.id}
                      kind="task"
                      className={cn(
                        "absolute z-10 flex items-center overflow-hidden px-2",
                        os ? "os-bar-label os-bar-label--task rounded-xl" : "rounded-lg",
                      )}
                      style={{
                        ...barX("task", b.left, b.width, os),
                        top: b.top,
                        height: b.height,
                        border: os ? "none" : `1.5px solid ${LEVEL_COLOR.task}`,
                        ...(os
                          ? null
                          : {
                              background: `color-mix(in srgb, ${LEVEL_COLOR.task} 8%, transparent)`,
                            }),
                        ...dragStyle(
                          "task",
                          b.task.id,
                          barX("task", b.left, b.width, os).width,
                        ),
                      }}
                      draggable={editMode && Boolean(onReschedule)}
                      onDragStart={beginDrag("task", b.task.id)}
                      onResizeStart={(edge) => beginDrag("task", b.task.id, edge)}
                      title={b.task.title}
                      rows={[
                        { label: "Status", value: TASK_STATUS_LABEL[b.task.status] },
                        {
                          label: "Dates",
                          value: rangeLabel(b.task.startsAt, b.task.endsAt),
                        },
                      ]}
                      assignees={b.task.assignees}
                      onClick={guardClick(
                        onTaskClick ? () => onTaskClick(b.task.id) : undefined,
                      )}
                    >
                      <span
                        className={
                          os
                            ? "truncate text-[12px] font-semibold tracking-[0.24px]"
                            : "text-[11px] font-bold truncate"
                        }
                        // Under os the bar itself carries the ink.
                        style={os ? undefined : { color: LEVEL_COLOR.task }}
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
