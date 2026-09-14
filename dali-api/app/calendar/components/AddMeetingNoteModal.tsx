import { useEffect, useId, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import {
  MeetingNoteFields,
  meetingNotePayload,
  meetingNoteValid,
  useMeetingNote,
} from "~/calendar/components/MeetingNoteFields";
import type { EventMeetingDTO } from "~/calendar/lib/types";

// Attaching a note to an event that was created without one. Asks the same
// question the create form asks — what is this meeting about — and posts
// "add-meeting-note", which files the note exactly where creation would have,
// adopting the event into a meeting first when it doesn't have one yet.

const fieldClass =
  "w-full px-3.5 py-2.5 text-sm border border-border rounded-[10px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/40";
const labelClass =
  "block text-[11px] font-bold text-muted-foreground uppercase tracking-[0.08em] mb-2";

type Destination = { type: "Lab" | "Project"; id: string | null; label: string };

export function AddMeetingNoteModal({
  meeting,
  eventTitle,
  onClose,
}: {
  meeting: EventMeetingDTO;
  eventTitle: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const note = useMeetingNote();
  const fetcher = useFetcher<{ error?: string; notePageId?: string }>();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  // A note is the whole point of this modal, so the fields start switched on
  // and the event's own name seeds the General case.
  useEffect(() => {
    note.setEnabled(true);
    note.setLabel(eventTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The projects this member may file a note under — the same eligibility the
  // destination picker inside MeetingNoteFields draws its drives from.
  useEffect(() => {
    let live = true;
    fetch("/api/move-destinations", { credentials: "include" })
      .then((r) => r.json())
      .then((json: { destinations?: Destination[] }) => {
        if (!live) return;
        setProjects(
          (json.destinations ?? [])
            .filter((d) => d.type === "Project" && d.id)
            .map((d) => ({ id: d.id!, name: d.label })),
        );
      })
      .catch(() => {
        // Leave the list empty: a General note still files fine without it.
      });
    return () => {
      live = false;
    };
  }, []);

  // Open the note once it exists — writing in it is what the button was for,
  // and the popover behind now carries a link back to it either way.
  useEffect(() => {
    const id = fetcher.state === "idle" ? fetcher.data?.notePageId : null;
    if (id) {
      onClose();
      navigate(`/documents/${id}`);
    }
  }, [fetcher.state, fetcher.data, onClose, navigate]);

  const busy = fetcher.state !== "idle";
  const canSubmit = meetingNoteValid(note.state) && !busy;

  function submit() {
    const payload = meetingNotePayload(note.state);
    fetcher.submit(
      {
        intent: "add-meeting-note",
        meetingId: meeting.meetingId ?? "",
        source: meeting.source ? JSON.stringify(meeting.source) : "",
        meetingType: String(payload.meetingType ?? ""),
        meetingTypeLabel: String(payload.meetingTypeLabel ?? ""),
        projectId: String(payload.projectId ?? ""),
        noteLocation: payload.noteLocation ? JSON.stringify(payload.noteLocation) : "",
      },
      { method: "post", action: meeting.actionPath },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={titleId}
      disableEscape={busy}
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-lg w-full p-5 sm:p-6 my-auto max-h-[85vh] overflow-y-auto"
    >
      <ModalHeader
        titleId={titleId}
        title="Add meeting notes"
        subtitle={`A note page for “${eventTitle}”, filed where meetings of its kind belong.`}
        onClose={onClose}
      />
      <MeetingNoteFields
        note={note}
        myProjects={projects}
        fieldClass={fieldClass}
        labelClass={labelClass}
        core={meeting.isCoreMeeting}
        className="space-y-3"
      />
      {fetcher.data?.error && (
        <p className="mt-3 text-sm text-red-600">{fetcher.data.error}</p>
      )}
      <div className="flex items-center justify-end gap-2 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <Button type="button" size="sm" onClick={submit} disabled={!canSubmit}>
          {busy ? "Creating…" : "Create note"}
        </Button>
      </div>
    </Modal>
  );
}
