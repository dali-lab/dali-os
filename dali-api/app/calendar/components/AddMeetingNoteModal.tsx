import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFetcher, useNavigate } from "react-router";
import { FileText, Plus, X } from "lucide-react";
import {
  useMeetingNote,
  meetingNoteValid,
  meetingNotePayload,
  MeetingNoteFields,
} from "~/calendar/components/MeetingNoteFields";
import { filedNoteFrom, type FiledNoteResponse } from "~/calendar/lib/filed-note";
import { useFiledNoteToast } from "~/calendar/lib/useFiledNoteToast";
import { useSeriesNotebook } from "~/calendar/lib/useSeriesNotebook";

// Post-hoc counterpart to the create modal's meeting-note fields: adds a notes
// doc to a meeting that was created without one. The note config (About, which
// notebook) isn't captured for a note-less meeting, so this collects it the same
// way the create form does and posts the `add-meeting-note` calendar action,
// which files the doc and links it. A revalidation then swaps the popover's "Add meeting notes" affordance for
// the "Meeting notes" link.

type MoveDestination = { type: "Lab" | "Project"; id: string | null; label: string };

const fieldClass =
  "w-full px-3.5 py-2.5 text-sm border border-border rounded-[10px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/40";
const labelClass =
  "block text-[11px] font-bold text-muted-foreground uppercase tracking-[0.08em] mb-2";

/** Makes the note for one occurrence of a meeting that already keeps notes
 *  (the meeting's type and filing are known, so there is nothing to ask), says
 *  where it went, and opens it. */
export function useOpenMeetingNote({
  meetingId,
  occurrenceStart,
  actionPath,
}: {
  meetingId: string;
  occurrenceStart: string;
  actionPath?: string;
}) {
  const fetcher = useFetcher<FiledNoteResponse>();
  const navigate = useNavigate();
  const showFiledNote = useFiledNoteToast();
  // Guards against stale fetcher.data from an earlier submit navigating a
  // fresh click away before it has even been made.
  const submittedRef = useRef(false);
  useEffect(() => {
    if (submittedRef.current && fetcher.state !== "submitting" && fetcher.data?.notePageId) {
      submittedRef.current = false;
      const filed = filedNoteFrom(fetcher.data);
      // Already on its way to the note, so the toast only says where it went.
      if (filed) showFiledNote(filed, { open: false });
      navigate(`/documents/${fetcher.data.notePageId}`);
    }
  }, [fetcher.state, fetcher.data, navigate, showFiledNote]);
  const open = useCallback(() => {
    submittedRef.current = true;
    fetcher.submit(
      { intent: "add-meeting-note", meetingId, occurrence: occurrenceStart },
      { method: "post", ...(actionPath ? { action: actionPath } : {}) },
    );
  }, [fetcher, meetingId, occurrenceStart, actionPath]);
  return { open, pending: fetcher.state !== "idle", error: fetcher.data?.error ?? null };
}

/** "Meeting note" for an occurrence of a meeting that already keeps notes but
 *  has none for this occurrence yet. */
export function OpenMeetingNoteButton({
  meetingId,
  occurrenceStart,
  actionPath,
  className,
}: {
  meetingId: string;
  occurrenceStart: string;
  actionPath?: string;
  className?: string;
}) {
  const note = useOpenMeetingNote({ meetingId, occurrenceStart, actionPath });
  return (
    <>
      <button type="button" className={className} disabled={note.pending} onClick={note.open}>
        <FileText className="h-3.5 w-3.5 text-os-grey" /> Meeting note
      </button>
      {note.error && <p className="w-full text-[12px] text-red-600">{note.error}</p>}
    </>
  );
}

/** The popover's "Add meeting notes" button + the modal it opens. Rendered only
 *  when the meeting has no note yet and the viewer may add one. */
export function AddMeetingNoteButton({
  meetingId,
  meetingTitle,
  occurrenceStart,
  isCoreMeeting,
  actionPath,
  className,
}: {
  meetingId: string;
  /** Seeds a new notebook's name. */
  meetingTitle?: string;
  /** Which occurrence the first note is for (ISO); omitted = the first. */
  occurrenceStart?: string;
  isCoreMeeting: boolean;
  /** Route the action posts to; defaults to the current route. */
  actionPath?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5 text-os-grey" /> Add meeting notes
      </button>
      {open && (
        <AddMeetingNoteModal
          meetingId={meetingId}
          meetingTitle={meetingTitle}
          occurrenceStart={occurrenceStart}
          isCoreMeeting={isCoreMeeting}
          actionPath={actionPath}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AddMeetingNoteModal({
  meetingId,
  meetingTitle,
  occurrenceStart,
  isCoreMeeting,
  actionPath,
  onClose,
}: {
  meetingId: string;
  meetingTitle?: string;
  occurrenceStart?: string;
  isCoreMeeting: boolean;
  actionPath?: string;
  onClose: () => void;
}) {
  const note = useMeetingNote();
  const fetcher = useFetcher<FiledNoteResponse & { seriesNotebookId?: string | null }>();
  const showFiledNote = useFiledNoteToast();
  const { offerFutureFiling } = useSeriesNotebook();
  const [myProjects, setMyProjects] = useState<{ id: string; name: string }[]>([]);

  // The note is being added explicitly, so it's always "enabled" — the toggle
  // that gates it in the create form has no place here.
  useEffect(() => {
    note.setEnabled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Project list for the About picker — the same authorized set the create form
  // feeds it (Lab-wide dropped; a Core note has no project to file under).
  useEffect(() => {
    if (isCoreMeeting) return;
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
  }, [isCoreMeeting]);

  // Close only this modal on Escape — capture-phase + stopPropagation keeps the
  // key from reaching the popover's own Escape handler and closing that too.
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
  // loader revalidation that follows to finish — the popover picks up the new
  // note link on its own once that lands.
  useEffect(() => {
    if (submittedRef.current && fetcher.state !== "submitting" && fetcher.data?.ok) {
      submittedRef.current = false;
      const filed = filedNoteFrom(fetcher.data);
      if (filed) showFiledNote(filed);
      onClose();
      void offerFutureFiling(meetingId, {
        notebookId: fetcher.data.notebookId ?? null,
        seriesNotebookId: fetcher.data.seriesNotebookId ?? null,
      });
    }
  }, [fetcher.state, fetcher.data, onClose, showFiledNote, offerFutureFiling, meetingId]);

  const valid = meetingNoteValid(note.state);

  function submit() {
    const payload = meetingNotePayload(note.state);
    const fields: Record<string, string> = {
      intent: "add-meeting-note",
      meetingId,
      notebook: JSON.stringify(payload.notebook),
    };
    if (occurrenceStart) fields.occurrence = occurrenceStart;
    if (payload.projectId) fields.projectId = String(payload.projectId);
    submittedRef.current = true;
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
          <h2 className="font-heading text-base font-semibold text-foreground">Add meeting notes</h2>
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
            Starts a shared note doc linked to this meeting.
          </p>
          {/* MeetingNoteFields indents its rows for the create form's toggle; a
              negative left margin pulls them back flush inside this modal. */}
          <div className="-ml-6">
            <MeetingNoteFields
              note={note}
              myProjects={myProjects}
              fieldClass={fieldClass}
              labelClass={labelClass}
              core={isCoreMeeting}
              meetingTitle={meetingTitle}
              meetingId={meetingId}
            />
          </div>
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
            {submitting ? "Creating…" : "Create note"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
