import { useState, type CSSProperties, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { GripVertical, Plus, X } from "lucide-react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { buttonClasses } from "~/components/ui/Button";
import { Menu, Tooltip } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { blockDates } from "~/hiring/lib/cycle-phases";
import {
  MAX_WEEK,
  blockKey,
  blockLabel,
  canInsertAt,
  canRemove,
  newRoundId,
  validateTimeline,
  weekIssues,
  type Timeline,
  type TimelineBlock,
} from "~/hiring/lib/cycle-timeline";
import { cn } from "~/lib/cn";
import { AlertIcon, SetupCard } from "./SetupCard";

const DAY_MS = 24 * 60 * 60 * 1000;
// Setup and Review always open the timeline (validateTimeline); only what
// follows them, up to Decisions, can move.
const FIXED_HEAD = 2;

// Term dates are UTC-midnight stamps for calendar days, so format in UTC.
function formatDay(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Why a block's X is disabled, or null when it can go. */
function removeBlockedReason(
  t: Timeline,
  b: TimelineBlock,
  withBoards: Set<string>,
  structureLocked: boolean,
): string | null {
  if (b.kind === "phase" && b.key !== "interviews") return "Required";
  if (b.kind === "delib" && withBoards.has(b.id)) return "Has a board";
  if (structureLocked) return "Locked once the cycle opens";
  if (!canRemove(t, b, withBoards)) {
    // Removing it would leave an invalid timeline; name the rule it breaks.
    const why = validateTimeline(t.filter((x) => x !== b)) ?? "";
    return why.startsWith("Interviews") ? "Interviews needs it" : "Required";
  }
  return null;
}

// The cycle's timeline, edited as a draft: move blocks between weeks, rename
// delib rounds, add, remove or drag rounds and Interviews into another order.
// Setup and Review stay on top and Decisions at the bottom. One Save
// posts the whole timeline. Adding, removing or reordering blocks is only
// possible in Draft (it changes who gets decided when); weeks and round names
// can change anytime.
export function TimelineCard({
  timeline,
  roundsWithBoards,
  cycleStatus,
  termStart,
  isDefault,
}: {
  timeline: Timeline;
  roundsWithBoards: string[];
  cycleStatus: string;
  termStart: Date | null;
  /** Whether the saved timeline is the audience's default (hides Reset). */
  isDefault: boolean;
}) {
  const { formClass, bodyText } = useOsChrome();
  const fetcher = useFetcher<{ error?: string }>();
  const [draft, setDraft] = useState<Timeline>(timeline);
  // Reset the draft whenever the saved timeline changes (save, reset, reload).
  const saved = JSON.stringify(timeline);
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setDraft(timeline);
  }
  const withBoards = new Set(roundsWithBoards);
  const structureLocked = cycleStatus !== "Draft";
  const busy = fetcher.state !== "idle";
  const dirty = JSON.stringify(draft) !== saved;
  const invalid = validateTimeline(draft);
  // Rows whose weeks don't line up get a "!" with the reason.
  const issues = weekIssues(draft);

  const update = (i: number, change: Partial<TimelineBlock>) =>
    setDraft((t) => t.map((b, j) => (j === i ? ({ ...b, ...change } as TimelineBlock) : b)));
  const setWeek = (i: number, end: 0 | 1, value: number) =>
    setDraft((t) =>
      t.map((b, j) => {
        if (j !== i) return b;
        const weeks: [number, number] = [...b.weeks];
        weeks[end] = value;
        return { ...b, weeks };
      }),
    );
  // A new block goes in the last slot that keeps the timeline valid (usually
  // just above Decisions), copying the week of the block ahead of it so the
  // timeline stays in order; drag it elsewhere from there.
  const lastValidSlot = (make: (weeks: [number, number]) => TimelineBlock) => {
    for (let i = draft.length - 1; i >= FIXED_HEAD; i--) {
      const w = draft[i - 1].weeks;
      const block = make([w[1], w[1]]);
      if (canInsertAt(draft, i, block)) return { i, block };
    }
    return null;
  };
  const roundCount = draft.filter((b) => b.kind === "delib").length;
  const addOptions = structureLocked
    ? []
    : [
        {
          label: "Delib round",
          slot: lastValidSlot((weeks) => ({
            kind: "delib",
            id: newRoundId(draft),
            label: `Delib ${roundCount + 1}`,
            weeks,
          })),
        },
        { label: "Interviews", slot: lastValidSlot((weeks) => ({ kind: "phase", key: "interviews", weeks })) },
      ].filter((o) => o.slot !== null);

  // Only the rounds and Interviews between Review and Decisions move.
  const head = draft.slice(0, FIXED_HEAD);
  const middle = draft.slice(FIXED_HEAD, -1);
  const tail = draft.slice(-1);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = middle.findIndex((b) => blockKey(b) === active.id);
    const to = middle.findIndex((b) => blockKey(b) === over.id);
    if (from < 0 || to < 0) return;
    setDraft([...head, ...arrayMove(middle, from, to), ...tail]);
  };

  const weekInput = (i: number, end: 0 | 1, b: TimelineBlock) => (
    <input
      type="number"
      min={1}
      max={MAX_WEEK}
      step={1}
      value={b.weeks[end]}
      onChange={(e) => setWeek(i, end, Number(e.target.value))}
      aria-label={`${blockLabel(b)} ${end ? "end" : "start"} week`}
      className="h-9 w-16"
    />
  );

  // One timeline row. `handle` is the drag grip's props for rounds and
  // Interviews; fixed blocks get an empty spacer so everything lines up.
  const row = (b: TimelineBlock, i: number, handle: Record<string, unknown> | null) => {
    const blocked = removeBlockedReason(draft, b, withBoards, structureLocked);
    const dates = termStart ? blockDates(termStart, b.weeks) : null;
    return (
      <div
        key={blockKey(b)}
        className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-well px-3 py-3"
      >
        <span className="flex items-center gap-2">
          {handle && !structureLocked ? (
            <button
              type="button"
              {...handle}
              aria-label={`Drag ${blockLabel(b)}`}
              className="cursor-grab touch-none rounded p-1 text-os-grey hover:text-foreground active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <span className="w-6" aria-hidden />
          )}
          {issues[i] && <AlertIcon label={`Weeks don't line up: ${blockLabel(b)} ${issues[i]}.`} />}
          {b.kind === "delib" ? (
            <input
              type="text"
              value={b.label}
              onChange={(e) => update(i, { label: e.target.value })}
              aria-label="Round name"
              className="h-9 w-40 font-semibold"
            />
          ) : (
            <span className="min-w-[6.5rem] text-sm font-semibold text-foreground">{blockLabel(b)}</span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-os-grey">
          Week {weekInput(i, 0, b)} to {weekInput(i, 1, b)}
          {dates && (
            <span className="min-w-[8rem] text-right">
              {formatDay(dates.start)} – {formatDay(new Date(dates.end.getTime() - DAY_MS))}
            </span>
          )}
          <Tooltip content={blocked}>
            <span>
              <button
                type="button"
                disabled={blocked !== null}
                onClick={() => setDraft((t) => t.filter((x) => x !== b))}
                aria-label={`Remove ${blockLabel(b)}`}
                className="rounded-os-item p-1.5 text-os-grey transition-colors hover:bg-os-container hover:text-foreground disabled:opacity-20 disabled:hover:bg-transparent"
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          </Tooltip>
        </span>
      </div>
    );
  };

  return (
    <SetupCard title="Timeline">
      <div className={cn(formClass, "flex flex-col gap-2")}>
        {head.map((b, i) => row(b, i, null))}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={middle.map(blockKey)} strategy={verticalListSortingStrategy}>
            {middle.map((b, j) => (
              <SortableRow key={blockKey(b)} id={blockKey(b)} disabled={structureLocked}>
                {(handle) => row(b, j + FIXED_HEAD, handle)}
              </SortableRow>
            ))}
          </SortableContext>
        </DndContext>
        {tail.map((b) => row(b, draft.length - 1, null))}
      </div>
      {addOptions.length > 0 && (
        <Menu
          ariaLabel="Add to timeline"
          trigger={
            <button type="button" className={cn(buttonClasses("secondary", "md"), "w-full")}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add
            </button>
          }
        >
          {addOptions.map((o) => (
            <Menu.Item
              key={o.label}
              onSelect={() => {
                const { i, block } = o.slot!;
                setDraft((t) => [...t.slice(0, i), block, ...t.slice(i)]);
              }}
            >
              {o.label}
            </Menu.Item>
          ))}
        </Menu>
      )}
      {(fetcher.data?.error || (dirty && invalid)) && (
        <p className="text-sm text-red-700">{fetcher.data?.error ?? invalid}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !dirty || invalid !== null}
          onClick={() =>
            fetcher.submit({ intent: "set-timeline", timeline: JSON.stringify(draft) }, { method: "post" })
          }
          className={buttonClasses("primary", "md")}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {dirty && (
          <button type="button" onClick={() => setDraft(timeline)} className={buttonClasses("secondary", "md")}>
            Discard
          </button>
        )}
        {!isDefault && !dirty && (
          <button
            type="button"
            disabled={busy || structureLocked}
            onClick={() => fetcher.submit({ intent: "set-timeline", reset: "1" }, { method: "post" })}
            className={buttonClasses("secondary", "md")}
          >
            Reset to default
          </button>
        )}
        {!termStart && <span className={bodyText}>Pick a term to see dates.</span>}
      </div>
    </SetupCard>
  );
}

// A draggable timeline row. Owns the dnd-kit node ref and transform and hands
// the grip its drag props, so the inputs in the row stay clickable.
function SortableRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (handle: Record<string, unknown>) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}
