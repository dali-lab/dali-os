import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "react-router";
import { Shapes, X } from "lucide-react";

// Post-hoc counterpart to the create modal's whiteboard toggle: adds a whiteboard
// to a meeting that doesn't have one, posting the `add-meeting-whiteboard`
// calendar action. The server files the board beside the meeting's note, or at
// its space's receiver folder. A revalidation then swaps the "Add whiteboard"
// affordance for the "Whiteboard" link. Only rendered when the whiteboard flag
// is on and no board exists yet.

export function AddMeetingWhiteboardButton({
  meetingId,
  hasType,
  actionPath,
  className,
}: {
  meetingId: string;
  /** Callers that still pass it are ignored: where the board is filed decides Core. */
  isCoreMeeting?: boolean;
  hasType: boolean;
  actionPath?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Shapes className="h-3.5 w-3.5 text-os-grey" /> Add whiteboard
      </button>
      {open && (
        <AddMeetingWhiteboardModal
          meetingId={meetingId}
          hasType={hasType}
          actionPath={actionPath}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AddMeetingWhiteboardModal({
  meetingId,
  hasType,
  actionPath,
  onClose,
}: {
  meetingId: string;
  hasType: boolean;
  actionPath?: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();

  // Close only this modal on Escape (capture + stopPropagation) so the key
  // doesn't also close the popover behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const submitting = fetcher.state !== "idle";
  // Guards against stale fetcher.data from an earlier submit closing a
  // freshly reopened modal before this one has submitted anything.
  const submittedRef = useRef(false);
  // Closes as soon as the action result arrives rather than waiting for the
  // loader revalidation that follows to finish.
  useEffect(() => {
    if (submittedRef.current && fetcher.state !== "submitting" && fetcher.data?.ok) {
      submittedRef.current = false;
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose]);

  function submit() {
    submittedRef.current = true;
    fetcher.submit(
      { intent: "add-meeting-whiteboard", meetingId },
      { method: "post", ...(actionPath ? { action: actionPath } : {}) },
    );
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-xl cal-surface max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-heading text-base font-semibold text-foreground">Add whiteboard</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          <p className="text-sm text-muted-foreground">
            {hasType
              ? "Starts a shared whiteboard canvas linked to this meeting, filed alongside the meeting note."
              : "Starts a shared whiteboard canvas linked to this meeting."}
          </p>
          {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-os-accent px-4 py-2 text-sm font-semibold text-os-bg hover:bg-os-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create whiteboard"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
