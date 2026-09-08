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
import { DateField } from "~/components/ui/DateField";
import { TimeField } from "~/components/ui/TimeField";
import { AddFormModal } from "~/education/components/AddFormModal";
import { JourneyBand, type JourneyStop, type CertificateNode } from "./JourneyBand";
import { LiveCheckInCount } from "./LiveCheckInCount";
import { ShowQrModal } from "./ShowQrModal";
import { ScheduleDialog } from "./ScheduleDialog";

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
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  // Combine date + time into datetime-local string for the hidden inputs
  const datetime = date && startTime ? `${date}T${startTime}` : "";
  const endsAt = date && endTime ? `${date}T${endTime}` : "";

  return (
    <AddFormModal
      open={open}
      onClose={() => { setDate(""); setStartTime(""); setEndTime(""); onClose(); }}
      title="Add session"
      intent="add-session"
      submitLabel="Add session"
    >
      {/* Hidden fields carry the combined datetime-local strings */}
      <input type="hidden" name="datetime" value={datetime} />
      <input type="hidden" name="endsAt" value={endsAt} />
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
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">
            Date <span className="text-destructive">*</span>
          </label>
          <DateField
            mode="date"
            value={date}
            onChange={setDate}
            ariaLabel="Session date"
            className="w-full"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              Start time <span className="text-destructive">*</span>
            </label>
            <TimeField
              value={startTime}
              onChange={setStartTime}
              ariaLabel="Start time"
              className="w-full"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              End time <span className="font-normal">(optional)</span>
            </label>
            <TimeField
              value={endTime}
              onChange={setEndTime}
              ariaLabel="End time"
              className="w-full"
            />
          </div>
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

const WEEKDAY_CHIPS = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Mirror the server's generate-sessions weekday expansion exactly:
 * - Anchor the start date as UTC midnight; get its UTCDay.
 * - For each week 0..weeks-1 and each selected weekday, compute:
 *   offsetDays = ((wd - anchorDay + 7) % 7) + w * 7
 *   dateStr = anchor + offsetDays days (UTC)
 *   datetime = `${dateStr}T${startTime}` → parsed as local
 * Returns the datetime strings sorted chronologically, capped at 60.
 */
function computeSeriesPreview(
  startDate: string,
  weekdays: number[],
  startTime: string,
  weeks: number,
): string[] {
  if (!startDate || weekdays.length === 0 || !startTime || weeks < 1) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
  if (!/^\d{2}:\d{2}$/.test(startTime)) return [];
  const anchor = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(anchor.getTime())) return [];
  const anchorDay = anchor.getUTCDay();
  const uniqueWeekdays = [...new Set(weekdays)];
  const dates: string[] = [];
  const clampedWeeks = Math.min(26, Math.max(1, weeks));
  for (let w = 0; w < clampedWeeks; w++) {
    for (const wd of uniqueWeekdays) {
      const offsetDays = ((wd - anchorDay + 7) % 7) + w * 7;
      const dateStr = new Date(anchor.getTime() + offsetDays * 86_400_000)
        .toISOString()
        .slice(0, 10);
      dates.push(`${dateStr}T${startTime}`);
    }
  }
  dates.sort();
  return dates.slice(0, 60);
}

const SHORT_WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatPreviewDate(dtStr: string): string {
  // Parse as local date+time
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(dtStr);
  if (!m) return dtStr;
  // UTC-pinned calendar math for the date label
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return `${SHORT_WEEKDAY[d.getUTCDay()]} ${SHORT_MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function GenerateSeriesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [weeks, setWeeks] = useState(6);

  function toggleDay(day: number) {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  const preview = computeSeriesPreview(startDate, selectedDays, startTime, weeks);
  const PREVIEW_CAP = 6;

  return (
    <AddFormModal
      open={open}
      onClose={() => {
        setStartDate(""); setSelectedDays([]); setStartTime(""); setEndTime(""); setWeeks(6);
        onClose();
      }}
      title="Generate session series"
      intent="generate-sessions"
      submitLabel="Generate"
    >
      {/* Hidden weekdays repeated fields (one per selected day, as server expects) */}
      {selectedDays.map((d) => (
        <input key={d} type="hidden" name="weekdays" value={String(d)} />
      ))}
      {/* Hidden startDate / startTime / endTime / weeks */}
      <input type="hidden" name="startDate" value={startDate} />
      <input type="hidden" name="startTime" value={startTime} />
      <input type="hidden" name="endTime" value={endTime} />
      <input type="hidden" name="weeks" value={String(weeks)} />

      <div className="flex flex-col gap-4">
        {/* Start date */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">
            Start date <span className="text-destructive">*</span>
          </label>
          <DateField
            mode="date"
            value={startDate}
            onChange={setStartDate}
            ariaLabel="Series start date"
            className="w-full"
          />
        </div>

        {/* Weekday toggle strip */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">
            Repeat on
          </label>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_CHIPS.map((chip, day) => {
              const on = selectedDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  aria-label={WEEKDAY_NAMES[day]}
                  onClick={() => toggleDay(day)}
                  className={cn(
                    "flex aspect-square min-w-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                    on
                      ? "bg-accent-teal text-white"
                      : "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {chip}
                </button>
              );
            })}
          </div>
        </div>

        {/* Start / end time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              Start time <span className="text-destructive">*</span>
            </label>
            <TimeField
              value={startTime}
              onChange={setStartTime}
              ariaLabel="Start time"
              className="w-full"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              End time <span className="font-normal">(optional)</span>
            </label>
            <TimeField
              value={endTime}
              onChange={setEndTime}
              ariaLabel="End time"
              className="w-full"
            />
          </div>
        </div>

        {/* Weeks stepper */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">
            Number of weeks
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease weeks"
              onClick={() => setWeeks((w) => Math.max(1, w - 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              −
            </button>
            <span className="w-8 text-center text-sm font-semibold text-foreground tabular-nums">
              {weeks}
            </span>
            <button
              type="button"
              aria-label="Increase weeks"
              onClick={() => setWeeks((w) => Math.min(26, w + 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              +
            </button>
            <span className="text-xs text-muted-foreground">weeks (max 26)</span>
          </div>
        </div>

        {/* Location */}
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

        {/* Live preview */}
        {preview.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">
              Creates {preview.length} session{preview.length === 1 ? "" : "s"}:
            </p>
            <p className="text-xs text-foreground leading-relaxed">
              {preview.slice(0, PREVIEW_CAP).map(formatPreviewDate).join(", ")}
              {preview.length > PREVIEW_CAP && (
                <span className="text-muted-foreground">
                  {" "}…and {preview.length - PREVIEW_CAP} more
                </span>
              )}
            </p>
          </div>
        )}
        {selectedDays.length > 0 && startDate && startTime && preview.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No sessions match — check the date and weekdays.</p>
        )}
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
        "border-border text-muted-foreground hover:border-accent-teal/60 hover:text-accent-teal",
        selected && "ring-2 ring-accent-teal/60 border-accent-teal/60 text-accent-teal",
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
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
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
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors text-center"
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
  const [scheduleOpen, setScheduleOpen] = useState(false);
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
        className="shrink-0 flex flex-col items-center justify-center gap-1 w-20 h-16 rounded-2xl border-2 border-dashed border-border text-muted-foreground hover:border-accent-teal/60 hover:text-accent-teal transition-colors"
        title="Add session"
      >
        <span className="text-xl leading-none">+</span>
        <span className="text-[10px] font-semibold">Add</span>
      </button>

      {/* Generate series button */}
      <button
        type="button"
        onClick={() => setGenerateOpen(true)}
        className="shrink-0 flex flex-col items-center justify-center gap-1 px-3 h-16 rounded-2xl border border-border text-muted-foreground hover:border-accent-teal/60 hover:text-accent-teal transition-colors"
        title="Generate series"
      >
        <span className="text-[10px] font-semibold leading-snug text-center">
          Generate<br />series ›
        </span>
      </button>

      {/* Edit schedule button */}
      <button
        type="button"
        onClick={() => setScheduleOpen(true)}
        className="shrink-0 flex flex-col items-center justify-center gap-1 px-3 h-16 rounded-2xl border border-border text-muted-foreground hover:border-accent-teal/60 hover:text-accent-teal transition-colors"
        title="Edit schedule"
      >
        <span className="text-[10px] font-semibold leading-snug text-center">
          Edit<br />schedule ›
        </span>
      </button>
    </>
  );

  // Editor footer
  const editorFooter = (
    <p className="mt-3 text-xs text-muted-foreground text-center">
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
      <ScheduleDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        stops={stops}
        presentBySession={presentBySession}
      />

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
