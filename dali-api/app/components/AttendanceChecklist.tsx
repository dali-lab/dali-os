import { useState } from "react";

export type AttendanceRow = { userId: string; name: string; present: boolean };

// Rendered above a meeting-note document (a Page with Page.meetingNoteId
// set). One checkbox per invited participant; checking someone off marks
// them present, which the attendance API mirrors into a TimeEntry that
// feeds the Timesheet tab. See app/calendar/routes/api.scheduled-meetings.$id.attendance.ts.
export function AttendanceChecklist({
  meetingId,
  meetingLabel,
  canEdit,
  attendees,
}: {
  meetingId: string;
  meetingLabel: string;
  canEdit: boolean;
  attendees: AttendanceRow[];
}) {
  const [rows, setRows] = useState(attendees);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

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

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-heading font-semibold text-foreground">{meetingLabel} attendance</h2>
        <span className="text-xs text-muted-foreground">
          {presentCount} of {rows.length} present
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.userId} className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`attendance-${r.userId}`}
              checked={r.present}
              disabled={!canEdit || pendingIds.has(r.userId)}
              onChange={(e) => toggle(r.userId, e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <label htmlFor={`attendance-${r.userId}`} className="text-sm text-foreground">
              {r.name}
            </label>
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
