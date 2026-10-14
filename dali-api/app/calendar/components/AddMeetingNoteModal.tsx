import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFetcher, useNavigate } from "react-router";
import { FileText, Plus, X } from "lucide-react";
import {
  useMeetingNote,
  meetingNoteValid,
  meetingNotePayload,
  inviteOf,
  MeetingNoteFields,
  type FilingSuggestionInput,
} from "~/calendar/components/MeetingNoteFields";
import { filedNoteFrom, type FiledNoteResponse } from "~/calendar/lib/filed-note";
import { useFiledNoteToast } from "~/calendar/lib/useFiledNoteToast";
import { useSeriesNotebook } from "~/calendar/lib/useSeriesNotebook";
import { suggestInputOfMeeting } from "~/calendar/lib/note-suggest-input";
import type { EditContext } from "~/calendar/components/EditMeetingModal";

// Post-hoc counterpart to the create modal's meeting-note fields: adds a notes
// doc to a meeting that was created without one. The note config (which
// notebook, where it is filed) isn't captured for a note-less meeting, so this
// collects it the same way the create form does and posts the `add-meeting-note`
// calendar action, which files the doc and links it. A revalidation then swaps
// the popover's "Add meeting notes" affordance for the "Meeting notes" link.

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
  meetingId?: string;
  occurrenceStart?: string;
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
  const openOccurrence = useCallback(
    (target: { meetingId: string; occurrenceStart: string }) => {
      submittedRef.current = true;
      fetcher.submit(
        { intent: "add-meeting-note", meetingId: target.meetingId, occurrence: target.occurrenceStart },
        { method: "post", ...(actionPath ? { action: actionPath } : {}) },
      );
    },
    [fetcher, actionPath],
  );
  const open = useCallback(
    () => openOccurrence({ meetingId: meetingId ?? "", occurrenceStart: occurrenceStart ?? "" }),
    [openOccurrence, meetingId, occurrenceStart],
  );
  return { open, openOccurrence, pending: fetcher.state !== "idle", error: fetcher.data?.error ?? null };
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
  actionPath,
  className,
}: {
  meetingId: string;
  /** Seeds a new notebook's name. */
  meetingTitle?: string;
  /** Which occurrence the first note is for (ISO); omitted = the first. */
  occurrenceStart?: string;
  /** Callers that still pass it are ignored: where the note is filed decides Core. */
  isCoreMeeting?: boolean;
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
  actionPath,
  onClose,
}: {
  meetingId: string;
  meetingTitle?: string;
  occurrenceStart?: string;
  actionPath?: string;
  onClose: () => void;
}) {
  const note = useMeetingNote();
  const fetcher = useFetcher<FiledNoteResponse & { seriesNotebookId?: string | null }>();
  const showFiledNote = useFiledNoteToast();
  const { offerFutureFiling } = useSeriesNotebook();

  // The guests decide which notebooks are suggested. A meeting the viewer can't
  // read the context of just gets no suggestions.
  const [suggest, setSuggest] = useState<FilingSuggestionInput | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/scheduled-meetings/${meetingId}/edit-context`, { credentials: "include" })
      .then(async (res) => (res.ok ? suggestInputOfMeeting((await res.json()) as EditContext) : null))
      .catch(() => null)
      .then((input) => {
        if (!cancelled) setSuggest(input);
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  // The note is being added explicitly, so it's always "enabled" — the toggle
  // that gates it in the create form has no place here.
  useEffect(() => {
    note.setEnabled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const payload = meetingNotePayload(note.state, inviteOf([]));
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
          {suggest === undefined ? (
            <p className="text-sm text-muted-foreground">Loading</p>
          ) : (
            <MeetingNoteFields
              note={note}
              surface="note"
              fieldClass={fieldClass}
              labelClass={labelClass}
              meetingTitle={meetingTitle}
              meetingId={meetingId}
              suggest={suggest ?? undefined}
            />
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
            {submitting ? "Creating…" : "Create note"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
