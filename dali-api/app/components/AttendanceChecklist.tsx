import { useMemo, useState } from "react";
import { ChevronDown, ScanLine } from "lucide-react";
import { AttendeeScanner } from "~/components/AttendeeScanner";
import { Checkbox } from "~/components/ui/Checkbox";
import { AbsenceNoteButton } from "~/components/AbsenceNoteButton";
import { Select } from "~/components/ui/floating";
import { filterPillClass } from "~/components/ui/floating/styles";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
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
const COLLAPSE_OVER = 8;

// Rendered above a meeting-note document (a Page with Page.meetingNoteId
// set). One checkbox per invited participant; checking someone off marks
// them present, which the attendance API mirrors into a TimeEntry that
// feeds the Timesheet tab. See app/calendar/routes/api.scheduled-meetings.$id.attendance.ts.
export function AttendanceChecklist({
  meetingId,
  meetingLabel,
  canEdit,
  canNote = false,
  canScan = false,
  defaultScanning = false,
  plain = false,
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
  /** Offer the wallet-pass scanner. Still gated on the wallet-checkin flag. */
  canScan?: boolean;
  /** Start with the camera on, for a page opened to take attendance. */
  defaultScanning?: boolean;
  /** Drop the card and the fold, for a page that titles the section itself. */
  plain?: boolean;
  attendees: AttendanceRow[];
}) {
  const [rows, setRows] = useState(attendees);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<AttendeeSort>("name-asc");
  // A big roster would push the note itself below the fold, so it starts
  // folded; the header count still says how many are in.
  const [folded, setFolded] = useState(!plain && attendees.length > COLLAPSE_OVER);
  const expanded = !folded;
  const [scanning, setScanning] = useState(canScan && defaultScanning);

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

  function markScanned(userId: string) {
    setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, present: true } : r)));
  }

  const roster = (
    <ul
      id={`attendance-${meetingId}`}
      className={cn(
        "grid grid-cols-1 sm:grid-cols-2",
        plain ? "gap-x-8 gap-y-1" : "gap-x-6 gap-y-1.5",
      )}
    >
      {ordered.map((r) => (
        <li key={r.userId} className={cn(plain && "rounded-os-item px-3 py-2.5 transition-colors hover:bg-os-hover")}>
          <div className="flex min-w-0 items-start justify-between gap-2">
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
  );

  return (
    <section className={cn(!plain && "bg-card border border-border rounded-lg p-4")}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2",
          plain ? "mb-4 justify-end" : "justify-between",
          !plain && expanded && "mb-2",
        )}
      >
        {!plain && (
          <button
            type="button"
            onClick={() => setFolded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={`attendance-${meetingId}`}
            className="inline-flex items-center gap-1.5 rounded-md font-heading font-semibold text-foreground"
          >
            <ChevronDown
              className={cn("w-4 h-4 text-muted-foreground transition-transform", !expanded && "-rotate-90")}
              aria-hidden
            />
            Attendance
          </button>
        )}
        <div className="flex items-center gap-2">
          {canEdit && canScan && (
            <button
              type="button"
              onClick={() => {
                setScanning((v) => !v);
                setFolded(false);
              }}
              aria-pressed={scanning}
              className={buttonClasses(scanning ? "secondary" : "primary", plain ? "md" : "sm")}
            >
              <ScanLine className="w-4 h-4" aria-hidden />
              {scanning ? "Stop scanning" : "Scan passes"}
            </button>
          )}
          {expanded && rows.length > 1 && (
            <Select
              value={sort}
              options={SORTS}
              onChange={setSort}
              ariaLabel="Sort attendees"
              align="right"
              buttonClassName={filterPillClass()}
            />
          )}
          {!plain && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {presentCount} of {rows.length} present
            </span>
          )}
        </div>
      </div>
      {expanded &&
        (scanning ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
            <div className="lg:order-2">
              <AttendeeScanner meetingId={meetingId} onMarked={markScanned} />
            </div>
            <div className="min-w-0 lg:order-1">{roster}</div>
          </div>
        ) : (
          roster
        ))}
      {expanded && !canEdit && (
        <p className="mt-2 text-xs text-muted-foreground">
          Only the organizer or a project editor can mark attendance.
        </p>
      )}
    </section>
  );
}
