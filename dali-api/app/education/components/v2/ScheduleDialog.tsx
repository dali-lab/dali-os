import { useState } from "react";
import { useFetcher } from "react-router";
import { X, Trash2, Save } from "lucide-react";
import { Modal } from "~/components/Modal";
import { DateField } from "~/components/ui/DateField";
import { TimeField } from "~/components/ui/TimeField";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { cn } from "~/lib/cn";
import { toDatetimeLocal } from "~/education/components/OfferingFields";
import type { JourneyStop } from "./JourneyBand";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDate(value: string | Date): string {
  const local = toDatetimeLocal(value);
  return local.slice(0, 10);
}

function extractTime(value: string | Date): string {
  const local = toDatetimeLocal(value);
  return local.includes("T") ? (local.split("T")[1] ?? "") : "";
}

// ---------------------------------------------------------------------------
// Session row
// ---------------------------------------------------------------------------

type ScheduleRowProps = {
  stop: JourneyStop;
  hasAttendance: boolean;
};

function ScheduleRow({ stop, hasAttendance }: ScheduleRowProps) {
  const confirmSubmit = useConfirmSubmit();
  const updateFetcher = useFetcher<{ error?: string }>();
  const deleteFetcher = useFetcher<{ error?: string }>();

  const [date, setDate] = useState(() => extractDate(stop.datetime));
  const [startTime, setStartTime] = useState(() => extractTime(stop.datetime));
  const [endTime, setEndTime] = useState(() =>
    stop.endsAt ? extractTime(stop.endsAt) : "",
  );
  const [title, setTitle] = useState(stop.title ?? "");
  const [location, setLocation] = useState(stop.location ?? "");

  const datetimeValue = date && startTime ? `${date}T${startTime}` : "";
  const endsAtValue = date && endTime ? `${date}T${endTime}` : "";

  const saving = updateFetcher.state !== "idle";
  const deleting = deleteFetcher.state !== "idle";

  function handleSave() {
    if (!datetimeValue) return;
    const fd = new FormData();
    fd.set("intent", "update-session");
    fd.set("sessionId", stop.id);
    fd.set("title", title);
    fd.set("datetime", datetimeValue);
    fd.set("endsAt", endsAtValue);
    fd.set("location", location);
    // Trade-off: notes and recordingUrl are not in JourneyStop so they can't be
    // preserved here — the server will null them out. The schedule editor is
    // intentionally a date/title/location-only surface; full session editing
    // (notes, recording URL) belongs in the Session details pane below.
    updateFetcher.submit(fd, { method: "post" });
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      {/* Sequence badge */}
      <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
        {stop.sequence}
      </span>

      {/* Editable fields */}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {/* Title */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`Session ${stop.sequence}`}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent-teal/50"
        />

        {/* Date + times */}
        <div className="flex flex-wrap items-center gap-2">
          <DateField
            mode="date"
            value={date}
            onChange={setDate}
            ariaLabel={`Date for session ${stop.sequence}`}
            className="min-w-[130px]"
          />
          <TimeField
            value={startTime}
            onChange={setStartTime}
            ariaLabel={`Start time for session ${stop.sequence}`}
            className="w-[110px]"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <TimeField
            value={endTime}
            onChange={setEndTime}
            ariaLabel={`End time for session ${stop.sequence}`}
            className="w-[110px]"
          />
        </div>

        {/* Location */}
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location (optional)"
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent-teal/50"
        />

        {/* Error messages */}
        {updateFetcher.data?.error && (
          <p className="text-xs text-destructive">{updateFetcher.data.error}</p>
        )}
        {deleteFetcher.data?.error && (
          <p className="text-xs text-destructive">{deleteFetcher.data.error}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 mt-0.5">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !datetimeValue}
          aria-label="Save session"
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
            saving || !datetimeValue
              ? "text-muted-foreground/40 cursor-not-allowed"
              : "text-accent-teal hover:bg-accent-teal/10",
          )}
          title="Save"
        >
          <Save size={14} />
        </button>

        {hasAttendance ? (
          <span
            title="Sessions with attendance can't be deleted"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/30 cursor-not-allowed"
          >
            <Trash2 size={14} />
          </span>
        ) : (
          <deleteFetcher.Form
            method="post"
            onSubmit={confirmSubmit({
              title: "Delete session?",
              description: "This cannot be undone.",
              confirmLabel: "Delete",
              tone: "destructive",
            })}
          >
            <input type="hidden" name="intent" value="delete-session" />
            <input type="hidden" name="sessionId" value={stop.id} />
            <button
              type="submit"
              disabled={deleting}
              aria-label="Delete session"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </deleteFetcher.Form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScheduleDialog
// ---------------------------------------------------------------------------

export function ScheduleDialog({
  open,
  onClose,
  stops,
  presentBySession,
}: {
  open: boolean;
  onClose: () => void;
  stops: JourneyStop[];
  /** Map of sessionId → present count; any entry means the session has recorded attendance. */
  presentBySession: Record<string, number>;
}) {
  // titleId for aria
  const titleId = "schedule-dialog-title";

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 sm:p-6 overflow-y-auto"
      containerClassName="bg-card rounded-2xl shadow-brand-2 w-full max-w-2xl my-auto"
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              Edit schedule
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {stops.length} session{stops.length === 1 ? "" : "s"} · changes save per row
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Session rows */}
        <div className="flex flex-col gap-2 p-4 max-h-[70vh] overflow-y-auto">
          {stops.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground italic">
              No sessions yet.
            </p>
          ) : (
            stops.map((stop) => (
              <ScheduleRow
                key={stop.id}
                stop={stop}
                hasAttendance={presentBySession[stop.id] != null}
              />
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
