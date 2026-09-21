import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "react-router";
import { Shapes, X } from "lucide-react";
import {
  useMeetingNote,
  meetingNoteValid,
  meetingNotePayload,
  MeetingNoteFields,
} from "~/calendar/components/MeetingNoteFields";

// Post-hoc counterpart to the create modal's whiteboard toggle: adds a whiteboard
// to a meeting that doesn't have one, posting the `add-meeting-whiteboard`
// calendar action. When the meeting already knows its type (it has a note), the
// board files alongside it, so the modal is a one-click confirm; a note-less
// meeting collects the About/type the same way the add-note flow does. A
// revalidation then swaps the "Add whiteboard" affordance for the "Whiteboard"
// link. Only rendered when the whiteboard flag is on and no board exists yet.

type MoveDestination = { type: "Lab" | "Project"; id: string | null; label: string };

const fieldClass =
  "w-full px-3.5 py-2.5 text-sm border border-border rounded-[10px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/40";
const labelClass =
  "block text-[11px] font-bold text-muted-foreground uppercase tracking-[0.08em] mb-2";

export function AddMeetingWhiteboardButton({
  meetingId,
  isCoreMeeting,
  /** The meeting already has a recorded type (e.g. a note): the board reuses it,
   *  so the modal skips the About/type fields. */
  hasType,
  actionPath,
  className,
}: {
  meetingId: string;
  isCoreMeeting: boolean;
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
          isCoreMeeting={isCoreMeeting}
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
  isCoreMeeting,
  hasType,
  actionPath,
  onClose,
}: {
  meetingId: string;
  isCoreMeeting: boolean;
  hasType: boolean;
  actionPath?: string;
  onClose: () => void;
}) {
  const note = useMeetingNote();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [myProjects, setMyProjects] = useState<{ id: string; name: string }[]>([]);

  // Marks the board (not the note) as the requested asset for the shared fields.
  useEffect(() => {
    note.setWhiteboard(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only need the About picker's projects when the meeting has no type yet.
  useEffect(() => {
    if (hasType || isCoreMeeting) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/move-destinations", { credentials: "include" });
        const json = await res.json();
        const dests = (json.destinations ?? []) as MoveDestination[];
        if (!cancelled) {
          setMyProjects(
            dests
              .filter((d) => d.type === "Project" && d.id)
              .map((d) => ({ id: d.id!, name: d.label })),
          );
        }
      } catch {
        // No projects → About offers only "General"; the modal still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasType, isCoreMeeting]);

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
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  // With a known type the board reuses it; otherwise the shared fields must be
  // complete (a General/Other meeting needs a name).
  const valid = hasType || meetingNoteValid(note.state);

  function submit() {
    const fields: Record<string, string> = { intent: "add-meeting-whiteboard", meetingId };
    if (!hasType) {
      const payload = meetingNotePayload(note.state);
      if (payload.meetingType) fields.meetingType = String(payload.meetingType);
      if (payload.meetingTypeLabel) fields.meetingTypeLabel = String(payload.meetingTypeLabel);
      if (payload.projectId) fields.projectId = String(payload.projectId);
      if (payload.noteLocation) fields.noteLocation = JSON.stringify(payload.noteLocation);
    }
    fetcher.submit(fields, { method: "post", ...(actionPath ? { action: actionPath } : {}) });
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
          {!hasType && (
            // MeetingNoteFields indents its rows for the create form's toggle; a
            // negative left margin pulls them back flush inside this modal.
            <div className="-ml-6">
              <MeetingNoteFields
                note={note}
                myProjects={myProjects}
                fieldClass={fieldClass}
                labelClass={labelClass}
                core={isCoreMeeting}
              />
            </div>
          )}
          {fetcher.data?.error && <p className="text-sm text-red-600">{fetcher.data.error}</p>}
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
            disabled={!valid || submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-os-accent px-4 py-2 text-sm font-semibold text-white hover:bg-os-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create whiteboard"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
