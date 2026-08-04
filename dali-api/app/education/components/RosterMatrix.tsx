import { useState } from "react";
import { Form } from "react-router";
import { Check, Minus, X } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";

// The roster answers two questions with one grid: who is falling behind
// (rows × every session, with a running total) and who was here today (the
// selected session's column, editable in place).
//
// They were nearly split into two tabs. They aren't, because they read the
// same rows from the same query — two screens would mean two roster lists,
// two save paths, and a tab-switch to answer "is this person behind?" while
// looking at them. Marking is an edit to one column of the overview.

type Status = "Present" | "Absent" | "Excused";

export type MatrixSession = { id: string; sequence: number; datetime: string | Date };
export type MatrixStudent = {
  applicationId: string;
  name: string;
  marks: Record<string, Status>;
  attended: number;
};

const MARK_STYLE: Record<Status, { icon: typeof Check; className: string; label: string }> = {
  Present: { icon: Check, className: "text-accent-green", label: "Present" },
  Absent: { icon: X, className: "text-destructive", label: "Absent" },
  Excused: { icon: Minus, className: "text-muted-foreground", label: "Excused" },
};

export function RosterMatrix({
  sessions,
  students,
  activeSessionId,
  onSelectSession,
  formatSessionDate,
}: {
  sessions: MatrixSession[];
  students: MatrixStudent[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  formatSessionDate: (d: string | Date) => string;
}) {
  // Marking mode swaps the active column for a big-target list — a grid cell is
  // fine at a desk and hopeless when you're marking a room from a phone.
  const [marking, setMarking] = useState(false);
  const active = sessions.find((s) => s.id === activeSessionId) ?? null;

  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Add a session first — attendance is marked per session.
      </p>
    );
  }
  if (students.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No approved students yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Session</span>
          <Select
            value={activeSessionId ?? ""}
            onChange={(value) => onSelectSession(value)}
            options={sessions.map((s) => ({
              value: s.id,
              label: `Session ${s.sequence} — ${formatSessionDate(s.datetime)}`,
            }))}
            buttonClassName="rounded-md border border-border bg-card px-2 py-1.5 text-sm inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
        </label>
        {active && (
          <Button
            type="button"
            size="sm"
            variant={marking ? "secondary" : "primary"}
            onClick={() => setMarking((m) => !m)}
          >
            {marking ? "Back to roster" : "Take attendance"}
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {students.length} {students.length === 1 ? "student" : "students"} ·{" "}
          {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
        </span>
      </div>

      {marking && active ? (
        <MarkingList
          sessionId={active.id}
          students={students}
          onSaved={() => setMarking(false)}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky left-0 z-10 bg-card px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Student
                </th>
                {sessions.map((s) => (
                  <th
                    key={s.id}
                    className={`px-2 py-2.5 text-center font-medium ${
                      s.id === activeSessionId
                        ? "bg-accent-coral/10 text-accent-coral"
                        : "text-muted-foreground"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSession(s.id)}
                      className="whitespace-nowrap"
                      title={formatSessionDate(s.datetime)}
                    >
                      S{s.sequence}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">
                  Attended
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {students.map((st) => {
                const pct = Math.round((st.attended / sessions.length) * 100);
                return (
                  <tr key={st.applicationId} className="hover:bg-muted/40">
                    <td className="sticky left-0 z-10 bg-card px-4 py-2 font-medium text-foreground whitespace-nowrap">
                      {st.name}
                    </td>
                    {sessions.map((s) => {
                      const mark = st.marks[s.id];
                      const style = mark ? MARK_STYLE[mark] : null;
                      const Icon = style?.icon;
                      return (
                        <td
                          key={s.id}
                          className={`px-2 py-2 text-center ${
                            s.id === activeSessionId ? "bg-accent-coral/5" : ""
                          }`}
                        >
                          {Icon && style ? (
                            <span title={style.label}>
                              <Icon className={`mx-auto h-4 w-4 ${style.className}`} />
                              <span className="sr-only">{style.label}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40" title="Unmarked">
                              ·
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                      <span className="text-foreground">
                        {st.attended}/{sessions.length}
                      </span>{" "}
                      <span
                        className={
                          pct >= 75
                            ? "text-accent-green"
                            : pct >= 50
                              ? "text-muted-foreground"
                              : "text-destructive"
                        }
                      >
                        {pct}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The active session as a comfortable list, for marking a room quickly. */
function MarkingList({
  sessionId,
  students,
  onSaved,
}: {
  sessionId: string;
  students: MatrixStudent[];
  onSaved: () => void;
}) {
  return (
    <Form
      method="post"
      onSubmit={() => {
        // Drop back to the grid once the marks are on their way — the payoff
        // for marking a session is seeing it land in the overview.
        queueMicrotask(onSaved);
      }}
      className="rounded-lg border border-border bg-muted/40"
    >
      <input type="hidden" name="intent" value="save-attendance" />
      <input type="hidden" name="sessionId" value={sessionId} />
      <ul className="divide-y divide-border">
        {students.map((st) => (
          <li
            key={st.applicationId}
            className="flex items-center justify-between gap-4 bg-card px-4 py-2.5 first:rounded-t-lg"
          >
            <span className="text-sm text-foreground">{st.name}</span>
            <select
              name={`mark-${st.applicationId}`}
              defaultValue={st.marks[sessionId] ?? ""}
              aria-label={`Attendance for ${st.name}`}
              className="rounded-md border border-border bg-card px-2 py-1 text-sm"
            >
              <option value="">Unmarked</option>
              <option value="Present">Present</option>
              <option value="Absent">Absent</option>
              <option value="Excused">Excused</option>
            </select>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 rounded-b-lg border-t border-border bg-muted/40 px-4 py-3">
        <Button type="submit" size="sm">
          Save attendance
        </Button>
        <button
          type="button"
          onClick={(e) => {
            const form = e.currentTarget.closest("form");
            form
              ?.querySelectorAll<HTMLSelectElement>('select[name^="mark-"]')
              .forEach((el) => {
                el.value = "Present";
              });
          }}
          className="text-xs font-semibold text-accent-coral hover:underline"
        >
          Mark all Present
        </button>
      </div>
    </Form>
  );
}
