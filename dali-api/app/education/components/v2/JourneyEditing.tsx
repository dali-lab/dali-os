import { useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import {
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "~/lib/cn";
import { useToast } from "~/components/ui/toast";
import { AddFormModal } from "~/education/components/AddFormModal";
import { JourneyBand, type JourneyStop, type CertificateNode } from "./JourneyBand";
import { LiveCheckInCount } from "./LiveCheckInCount";
import { ShowQrModal } from "./ShowQrModal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFutureStop(stop: JourneyStop): boolean {
  const end = stop.endsAt ? new Date(stop.endsAt).getTime() : new Date(stop.datetime).getTime();
  return Date.now() < end;
}

function isHeroStop(stop: JourneyStop, heroId: string | null): boolean {
  return stop.id === heroId;
}

// ---------------------------------------------------------------------------
// Add Session Dialog
// ---------------------------------------------------------------------------

function AddSessionDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AddFormModal
      open={open}
      onClose={onClose}
      title="Add session"
      intent="add-session"
      submitLabel="Add session"
    >
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Title <span className="font-normal">(optional)</span>
          </label>
          <input
            name="title"
            type="text"
            placeholder="e.g. Introduction to React"
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Date &amp; time <span className="text-destructive">*</span>
          </label>
          <input
            name="datetime"
            type="datetime-local"
            required
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Ends at <span className="font-normal">(optional)</span>
          </label>
          <input
            name="endsAt"
            type="datetime-local"
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Location <span className="font-normal">(optional)</span>
          </label>
          <input
            name="location"
            type="text"
            placeholder="e.g. Sudikoff 115"
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
      </div>
    </AddFormModal>
  );
}

// ---------------------------------------------------------------------------
// Generate Series Dialog
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function GenerateSeriesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AddFormModal
      open={open}
      onClose={onClose}
      title="Generate session series"
      intent="generate-sessions"
      submitLabel="Generate"
    >
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Start date <span className="text-destructive">*</span>
          </label>
          <input
            name="startDate"
            type="date"
            required
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Repeat on
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((day, i) => (
              <label key={day} className="flex items-center gap-1 text-sm cursor-pointer select-none">
                <input type="checkbox" name="weekdays" value={String(i)} className="rounded" />
                {day}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Start time <span className="text-destructive">*</span>
            </label>
            <input
              name="startTime"
              type="time"
              required
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              End time
            </label>
            <input
              name="endTime"
              type="time"
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Number of weeks
          </label>
          <input
            name="weeks"
            type="number"
            min={1}
            max={26}
            defaultValue={6}
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Location <span className="font-normal">(optional)</span>
          </label>
          <input
            name="location"
            type="text"
            placeholder="e.g. Sudikoff 115"
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
      </div>
    </AddFormModal>
  );
}

// ---------------------------------------------------------------------------
// Sortable future tile wrapper
// ---------------------------------------------------------------------------

function SortableFutureTile({
  stop,
  selected,
  onSelect,
}: {
  stop: JourneyStop;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: "grab",
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      onClick={() => onSelect(stop.id)}
      className={cn(
        "shrink-0 flex flex-col items-center justify-center gap-1 w-16 h-16 rounded-2xl border-2 border-dashed transition-colors",
        "border-white/20 text-white/40 hover:border-white/40 hover:text-white/60",
        selected && "ring-2 ring-white/60 border-white/40 text-white/60",
      )}
      title={stop.title ?? `Session ${stop.sequence}`}
      {...attributes}
      {...listeners}
    >
      <span className="text-[10px] font-semibold">S{stop.sequence}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// renderStopExtras (exported)
// ---------------------------------------------------------------------------

export function renderStopExtras(
  stop: JourneyStop,
  presentBySession: Record<string, number>,
  heroId: string | null,
  onShowQr: (id: string) => void,
): ReactNode {
  const isHero = isHeroStop(stop, heroId);
  const count = presentBySession[stop.id];

  return (
    <div className="flex flex-col gap-2 mt-2">
      {/* Attendance rollup chip for past/current stops */}
      {count != null && (
        <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-white/70">
          {count} attended
        </span>
      )}

      {/* Live count when check-in is open */}
      {isHero && stop.checkInOpen && (
        <LiveCheckInCount sessionId={stop.id} initialPresent={count ?? 0} />
      )}

      {/* Hero: Show QR + Mark by hand */}
      {isHero && (
        <div className="flex flex-col gap-1.5 mt-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowQr(stop.id);
            }}
            className="rounded-lg bg-accent-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-teal/90 transition-colors text-left"
          >
            Show QR
          </button>
          <a
            href="#session-pane"
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20 transition-colors text-center"
          >
            Mark by hand
          </a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JourneyEditingLayer (main export)
// ---------------------------------------------------------------------------

export function JourneyEditingLayer({
  stops,
  certificate,
  selectedId,
  onSelect,
  tz,
  presentBySession,
  approvedCount,
  willEarnCount,
  threshold,
  bleedClassName,
  contentClassName,
}: {
  stops: JourneyStop[];
  certificate: CertificateNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  tz: string;
  presentBySession: Record<string, number>;
  approvedCount: number;
  willEarnCount: number;
  threshold: number;
  bleedClassName: string;
  contentClassName: string;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [qrSessionId, setQrSessionId] = useState<string | null>(null);
  const fetcher = useFetcher();
  const toast = useToast();

  // Find hero stop (current = in-progress OR earliest future)
  const now = Date.now();
  const heroStop =
    stops.find((s) => {
      const start = new Date(s.datetime).getTime();
      const end = s.endsAt ? new Date(s.endsAt).getTime() : start;
      return now >= start && now <= end;
    }) ??
    stops
      .filter((s) => new Date(s.datetime).getTime() > now)
      .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())[0] ??
    null;

  // Sortable future stops (not past, not hero, no attendance recorded yet)
  const sortableFutureIds = stops
    .filter(
      (s) =>
        isFutureStop(s) &&
        s.id !== heroStop?.id &&
        !presentBySession[s.id],
    )
    .map((s) => s.id);

  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentIds = optimisticOrder ?? sortableFutureIds;
    const oldIndex = currentIds.indexOf(String(active.id));
    const newIndex = currentIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(currentIds, oldIndex, newIndex);
    setOptimisticOrder(reordered);

    const fd = new FormData();
    fd.set("intent", "reorder-sessions");
    for (const id of reordered) fd.append("sessionIds", id);

    fetcher.submit(fd, { method: "post" });

    // On error, revert
    if (fetcher.state === "idle" && fetcher.data && (fetcher.data as { error?: string }).error) {
      setOptimisticOrder(null);
      toast.error("Failed to reorder sessions");
    }
  }

  // Build the custom trailing slot
  const trailingSlot = (
    <>
      {/* Sortable future tiles */}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext
          items={optimisticOrder ?? sortableFutureIds}
          strategy={horizontalListSortingStrategy}
        >
          {(optimisticOrder ?? sortableFutureIds).map((id) => {
            const stop = stops.find((s) => s.id === id);
            if (!stop) return null;
            return (
              <SortableFutureTile
                key={stop.id}
                stop={stop}
                selected={selectedId === stop.id}
                onSelect={onSelect}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      {/* Add session tile */}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="shrink-0 flex flex-col items-center justify-center gap-1 w-20 h-16 rounded-2xl border-2 border-dashed border-white/20 text-white/40 hover:border-accent-teal/60 hover:text-accent-teal-light transition-colors"
        title="Add session"
      >
        <span className="text-xl leading-none">+</span>
        <span className="text-[10px] font-semibold">Add</span>
      </button>

      {/* Generate series button */}
      <button
        type="button"
        onClick={() => setGenerateOpen(true)}
        className="shrink-0 flex flex-col items-center justify-center gap-1 px-3 h-16 rounded-2xl border border-white/15 text-white/40 hover:border-white/30 hover:text-white/60 transition-colors"
        title="Generate series"
      >
        <span className="text-[10px] font-semibold leading-snug text-center">
          Generate<br />series ›
        </span>
      </button>
    </>
  );

  // Editor footer
  const editorFooter = (
    <p className="mt-3 text-xs text-white/40 text-center">
      Drag to reorder · {Math.round(threshold * 100)}% attendance earns the certificate · {willEarnCount} will earn it
    </p>
  );

  return (
    <>
      <JourneyBand
        stops={stops}
        certificate={certificate}
        selectedId={selectedId}
        onSelect={onSelect}
        lens="editor"
        tz={tz}
        renderStopExtras={(stop) =>
          renderStopExtras(stop, presentBySession, heroStop?.id ?? null, setQrSessionId)
        }
        trailing={trailingSlot}
      />
      {editorFooter}

      <AddSessionDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <GenerateSeriesDialog open={generateOpen} onClose={() => setGenerateOpen(false)} />

      {qrSessionId && (
        <ShowQrModal
          open={!!qrSessionId}
          onClose={() => setQrSessionId(null)}
          sessionId={qrSessionId}
          approvedCount={approvedCount}
        />
      )}
    </>
  );
}
