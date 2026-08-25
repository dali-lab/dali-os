import { useState } from "react";
import { Form } from "react-router";
import { Check, Minus, X } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";
import { cn } from "~/lib/cn";

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

/** One assignment column for the Performance view. */
export type PerformanceAssignment = { id: string; title: string; points: number | null };
/** Per-student per-assignment grade/score for the Performance view. */
export type PerformanceSubmissions = Record<
  string,
  Record<string, { grade: string | null; score: number | null }>
>;

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
  assignments = [],
  submissionsByApp = {},
  completionByApp = {},
}: {
  sessions: MatrixSession[];
  students: MatrixStudent[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  formatSessionDate: (d: string | Date) => string;
  /** Assignment list for Performance view columns. */
  assignments?: PerformanceAssignment[];
  /** Per-student (applicationId) per-assignment grade/score. */
  submissionsByApp?: PerformanceSubmissions;
  /** Pre-computed attendance-based completion eligibility per applicationId. */
  completionByApp?: Record<string, boolean>;
}) {
  // Marking mode swaps the active column for a big-target list — a grid cell is
  // fine at a desk and hopeless when you're marking a room from a phone.
  const [marking, setMarking] = useState(false);
  const [view, setView] = useState<"attendance" | "performance">("attendance");
  const active = sessions.find((s) => s.id === activeSessionId) ?? null;

  // Reset marking when switching views.
  function switchView(next: "attendance" | "performance") {
    setView(next);
    if (next === "performance") setMarking(false);
  }

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
      {/* View toggle + session picker + actions */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Attendance | Performance toggle */}
        <div className="flex rounded-md border border-border overflow-hidden text-sm shrink-0">
          {(["attendance", "performance"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => switchView(v)}
              className={cn(
                "px-3 py-1.5 font-medium capitalize",
                view === v
                  ? "bg-accent-coral text-white"
                  : "text-muted-foreground hover:bg-muted/40",
              )}
            >
              {v === "attendance" ? "Attendance" : "Performance"}
            </button>
          ))}
        </div>

        {view === "attendance" && (
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
        )}

        {view === "attendance" && active && !marking && (
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={() => setMarking(true)}
          >
            Take attendance
          </Button>
        )}
        {view === "attendance" && marking && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setMarking(false)}
          >
            Back to roster
          </Button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {students.length} {students.length === 1 ? "student" : "students"} ·{" "}
          {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
        </span>
      </div>

      {view === "attendance" && marking && active ? (
        <MarkingList
          sessionId={active.id}
          students={students}
          onSaved={() => setMarking(false)}
        />
      ) : view === "attendance" ? (
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
      ) : (
        <PerformanceTable
          sessions={sessions}
          students={students}
          assignments={assignments}
          submissionsByApp={submissionsByApp}
          completionByApp={completionByApp}
        />
      )}
    </div>
  );
}

/** Performance view: attendance % + one column per assignment (score or grade) + completion. */
function PerformanceTable({
  sessions,
  students,
  assignments,
  submissionsByApp,
  completionByApp,
}: {
  sessions: MatrixSession[];
  students: MatrixStudent[];
  assignments: PerformanceAssignment[];
  submissionsByApp: PerformanceSubmissions;
  completionByApp: Record<string, boolean>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Completion is attendance-based — assignment scores are informational only and do not gate
        course completion.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 bg-card px-4 py-2.5 text-left font-medium text-muted-foreground">
                Student
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">
                Attendance %
              </th>
              {assignments.map((a) => (
                <th
                  key={a.id}
                  className="px-3 py-2.5 text-center font-medium text-muted-foreground max-w-[120px]"
                  title={a.title}
                >
                  <span className="block truncate max-w-[120px]">{a.title}</span>
                  {a.points != null && (
                    <span className="block text-[10px] font-normal">/{a.points} pts</span>
                  )}
                </th>
              ))}
              <th className="px-4 py-2.5 text-center font-medium text-muted-foreground whitespace-nowrap">
                Completion
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {students.map((st) => {
              const pct =
                sessions.length > 0
                  ? Math.round(
                      ((st.attended + Object.values(st.marks).filter((m) => m === "Excused").length) /
                        sessions.length) *
                        100,
                    )
                  : 0;
              const eligible = completionByApp[st.applicationId] ?? false;
              return (
                <tr key={st.applicationId} className="hover:bg-muted/40">
                  <td className="sticky left-0 z-10 bg-card px-4 py-2 font-medium text-foreground whitespace-nowrap">
                    {st.name}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    <span
                      className={
                        pct >= 80
                          ? "text-accent-green"
                          : pct >= 50
                            ? "text-muted-foreground"
                            : "text-destructive"
                      }
                    >
                      {pct}%
                    </span>
                  </td>
                  {assignments.map((a) => {
                    const sub = submissionsByApp[st.applicationId]?.[a.id];
                    let display: string;
                    if (!sub) {
                      display = "—";
                    } else if (a.points != null && sub.score != null) {
                      display = `${sub.score}/${a.points}`;
                      if (sub.grade) display += ` (${sub.grade})`;
                    } else if (sub.grade) {
                      display = sub.grade;
                    } else {
                      display = "—";
                    }
                    return (
                      <td
                        key={a.id}
                        className="px-3 py-2 text-center text-muted-foreground tabular-nums"
                        title={display === "—" ? "No submission" : display}
                      >
                        {display}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 text-center">
                    {eligible ? (
                      <span className="inline-flex items-center gap-1 text-accent-green text-xs font-semibold">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        Eligible
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Below threshold</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
