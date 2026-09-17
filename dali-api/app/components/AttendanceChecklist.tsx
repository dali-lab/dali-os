import { useMemo, useState } from "react";
import { ScanLine } from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { AbsenceNoteButton } from "~/components/AbsenceNoteButton";
import { Select } from "~/components/ui/floating";
import {
  attendeeSortOptions,
  sortAttendees,
  type AttendeeSort,
} from "~/lib/attendee-sort";

export type AttendanceRow = {
  userId: string;
  name: string;
  present: boolean;
  /** Only carried on rosters whose viewer may read notes — see `canNote`. */
  absenceNote?: string | null;
};

// This list mixes present and absent people, so "Checked in first" is a real
// ordering here (on /attendance the two are already separate columns).
const SORTS = attendeeSortOptions(["name-asc", "name-desc", "status"]);

// Rendered above a meeting-note document (a Page with Page.meetingNoteId
// set). One checkbox per invited participant; checking someone off marks
// them present, which the attendance API mirrors into a TimeEntry that
// feeds the Timesheet tab. See app/calendar/routes/api.scheduled-meetings.$id.attendance.ts.
export function AttendanceChecklist({
  meetingId,
  meetingLabel,
  canEdit,
  canNote = false,
  attendees,
}: {
  meetingId: string;
  meetingLabel: string;
  canEdit: boolean;
  /** Whether this viewer may read and write absence notes. Narrower than
   *  `canEdit`: the note action's gate is organizer / Core / project member,
   *  which a plain document editor doesn't satisfy, so a surface only opts in
   *  when it has resolved that same gate. */
  canNote?: boolean;
  attendees: AttendanceRow[];
}) {
  const [rows, setRows] = useState(attendees);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<AttendeeSort>("name-asc");

  const ordered = useMemo(() => sortAttendees(rows, sort), [rows, sort]);

  async function toggle(userId: string, next: boolean) {
    setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, present: next } : r)));
    setPendingIds((prev) => new Set(prev).add(userId));
    try {
      const res = await fetch(`/api/scheduled-meetings/${meetingId}/attendance`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, present: next }),
      });
      if (!res.ok) {
        // Revert on failure.
        setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, present: !next } : r)));
      }
    } catch {
      setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, present: !next } : r)));
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  const presentCount = rows.filter((r) => r.present).length;
  // Organizers get a shortcut into the wallet-pass scan station (opens full-tab
  // so the camera isn't squeezed into a doc pane). Gated by the same flag as the
  // member Add-to-Wallet buttons; the scan route re-checks it server-side.
  const walletCheckin = useFeatureFlag("wallet-checkin");

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="font-heading font-semibold text-foreground">Attendance</h2>
        <div className="flex items-center gap-2">
          {canEdit && walletCheckin && (
            <a
              href={`/calendar/scan/${meetingId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              title="Scan members' wallet passes to mark them present"
            >
              <ScanLine className="w-3.5 h-3.5" aria-hidden />
              Scan attendees
            </a>
          )}
          {rows.length > 1 && (
            <Select
              value={sort}
              options={SORTS}
              onChange={setSort}
              ariaLabel="Sort attendees"
              align="right"
            />
          )}
          <span className="text-xs text-muted-foreground">
            {presentCount} of {rows.length} present
          </span>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5">
        {ordered.map((r) => (
          <li key={r.userId}>
            <div className="flex items-start justify-between gap-2">
              <Checkbox
                checked={r.present}
                disabled={!canEdit || pendingIds.has(r.userId)}
                onChange={(e) => toggle(r.userId, e.target.checked)}
                label={r.name}
              />
              {/* Notes belong to an absence, so the editor follows whoever
                  isn't checked in. A note left behind on someone later marked
                  present keeps its button too, so nothing written becomes
                  uneditable. */}
              {canNote && (!r.present || r.absenceNote) && (
                <AbsenceNoteButton
                  meetingId={meetingId}
                  userId={r.userId}
                  name={r.name}
                  note={r.absenceNote ?? null}
                  onSaved={(note) =>
                    setRows((prev) =>
                      prev.map((row) =>
                        row.userId === r.userId ? { ...row, absenceNote: note } : row,
                      ),
                    )
                  }
                />
              )}
            </div>
            {canNote && r.absenceNote && (
              <p className="ml-6 mt-1 text-xs text-muted-foreground italic break-words">
                {r.absenceNote}
              </p>
            )}
          </li>
        ))}
      </ul>
      {!canEdit && (
        <p className="mt-2 text-xs text-muted-foreground">
          Only the organizer or a project editor can mark attendance.
        </p>
      )}
    </section>
  );
}
