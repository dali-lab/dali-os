import { useFetcher } from "react-router";
import { MessageSquarePlus, Pencil } from "lucide-react";
import { useDialog } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/floating";

// An absence note is a short aside ("excused — flu"), not a place for a
// paragraph; the cap keeps a roster row from turning into an essay.
export const ABSENCE_NOTE_MAX = 280;

// Add / edit / clear the absence note on one roster row. The prompt dialog is
// the app's standard text-entry surface; submitting an empty value clears the
// note.
//
// Every roster posts to the /attendance route action — it's the one place that
// writes MeetingAttendance.absenceNote, and it re-checks the organizer / Core /
// project-member gate server-side. Naming the action explicitly is what lets
// this button work from the per-meeting page and the meeting note as well as
// from /attendance itself.
export function AbsenceNoteButton({
  meetingId,
  userId,
  name,
  note,
  onSaved,
}: {
  meetingId: string;
  userId: string;
  name: string;
  note: string | null;
  /** Rosters that keep their own row state (AttendanceChecklist) use this to
   *  stay in step; pages that re-render from loader data can omit it. */
  onSaved?: (note: string | null) => void;
}) {
  const dialog = useDialog();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const label = note ? `Edit absence note for ${name}` : `Add an absence note for ${name}`;

  async function edit() {
    const next = await dialog.prompt({
      title: note ? "Edit absence note" : "Add absence note",
      description: `Why ${name} wasn't there — visible to whoever can mark attendance on this event, not to the rest of the invite list.`,
      label: "Note",
      placeholder: "Excused — class conflict",
      defaultValue: note ?? "",
      confirmLabel: "Save note",
      validate: (v) =>
        v.trim().length > ABSENCE_NOTE_MAX
          ? `Keep it under ${ABSENCE_NOTE_MAX} characters.`
          : null,
    });
    if (next === null) return;
    const trimmed = next.trim();
    fetcher.submit(
      { intent: "set-absence-note", meetingId, userId, note: trimmed },
      { method: "post", action: "/attendance" },
    );
    onSaved?.(trimmed || null);
  }

  return (
    <Tooltip content={note ? "Edit absence note" : "Add absence note"} placement="left">
      <button
        type="button"
        onClick={edit}
        disabled={busy}
        aria-label={label}
        className="p-1 rounded-md text-muted-foreground hover:text-accent-teal hover:bg-accent-teal/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal/40 disabled:opacity-50"
      >
        {note ? (
          <Pencil className="w-3.5 h-3.5" aria-hidden />
        ) : (
          <MessageSquarePlus className="w-3.5 h-3.5" aria-hidden />
        )}
      </button>
    </Tooltip>
  );
}
