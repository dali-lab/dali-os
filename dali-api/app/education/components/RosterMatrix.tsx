import { useState } from "react";
import { Form } from "react-router";
import { Check, Minus, X } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Select, Tooltip, InfoTip } from "~/components/ui/floating";
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

// The three answers an instructor gives. "Unmarked" isn't one of them: it's
// the state a student is already in, so it needs no button.
const MARK_CHOICES = ["Present", "Absent", "Excused"] as const;

const MARK_STYLE: Record<Status, { icon: typeof Check; className: string; label: string }> = {
  Present: { icon: Check, className: "text-accent-green", label: "Present" },
  Absent: { icon: X, className: "text-destructive", label: "Absent" },
  Excused: { icon: Minus, className: "text-os-grey", label: "Excused" },
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
      <p className="text-sm italic text-os-grey">
        Add a session first. Attendance is marked per session.
      </p>
    );
  }
  if (students.length === 0) {
    return <p className="text-sm italic text-os-grey">No approved students yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar. The toggle is alone in a left group and the per-view controls
          live in a right one, so switching views can't reflow the row under the
          pointer — the toggle used to sit in one wrapping row with the session
          picker and the action button, and losing them on the way to
          Performance moved the button you had just clicked. */}
      {/* min-h pins the row: the session picker is a hair taller than the
          buttons beside it, so losing it on the way to Performance still moved
          the toggle by a pixel or two. */}
      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-3">
        {/* A toggle, not navigation — so this one stays a filled segmented
            control while the page's sections are underlined tabs. Both states
            are the same box; only the fill changes. */}
        <div className="flex shrink-0 gap-1 rounded-os-item bg-os-well p-1 text-sm">
          {(["attendance", "performance"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => switchView(v)}
              aria-pressed={view === v}
              className={cn(
                "rounded-os-item px-4 py-1.5 font-medium transition-colors",
                view === v
                  ? "bg-os-accent text-os-card"
                  : "text-os-grey hover:text-foreground",
              )}
            >
              {v === "attendance" ? "Attendance" : "Performance"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {view === "attendance" && (
            <label className="os-form flex items-center gap-2">
              <span className="text-sm text-os-grey">Session</span>
              <Select
                value={activeSessionId ?? ""}
                onChange={(value) => onSelectSession(value)}
                options={sessions.map((s) => ({
                  value: s.id,
                  label: `Session ${s.sequence}, ${formatSessionDate(s.datetime)}`,
                }))}
                buttonClassName="min-w-[16rem]"
              />
            </label>
          )}
          {view === "attendance" && active && (
            <Button
              type="button"
              size="sm"
              variant={marking ? "secondary" : "primary"}
              onClick={() => setMarking(!marking)}
            >
              {marking ? "Done" : "Take attendance"}
            </Button>
          )}
          <span className="text-sm text-os-grey">
            {students.length} {students.length === 1 ? "student" : "students"} ·{" "}
            {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
          </span>
        </div>
      </div>

      {view === "attendance" && marking && active ? (
        <MarkingList
          sessionId={active.id}
          students={students}
          onSaved={() => setMarking(false)}
        />
      ) : view === "attendance" ? (
        <div className="overflow-x-auto rounded-os-card bg-os-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-os-container">
                <th className="sticky left-0 z-10 bg-os-card px-5 py-3 text-left font-medium text-os-grey">
                  Student
                </th>
                {sessions.map((s) => (
                  <th
                    key={s.id}
                    className={`px-2 py-2.5 text-center font-medium ${
                      s.id === activeSessionId
                        ? "bg-os-accent/10 text-os-accent"
                        : "text-os-grey"
                    }`}
                  >
                    <Tooltip content={formatSessionDate(s.datetime)}>
                      <button
                        type="button"
                        onClick={() => onSelectSession(s.id)}
                        className="whitespace-nowrap"
                      >
                        S{s.sequence}
                      </button>
                    </Tooltip>
                  </th>
                ))}
                <th className="whitespace-nowrap px-5 py-3 text-right font-medium text-os-grey">
                  <span className="inline-flex items-center gap-1">
                    Attended
                    <InfoTip
                      content="Sessions attended out of total. Green ≥ 75%, amber 50–74%, red < 50%. Excused absences count as attended for completion purposes."
                      placement="top"
                    />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {students.map((st) => {
                const pct = Math.round((st.attended / sessions.length) * 100);
                return (
                  <tr key={st.applicationId} className="hover:bg-os-well/60">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-os-card px-5 py-2.5 font-medium text-foreground">
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
                            s.id === activeSessionId ? "bg-os-accent/5" : ""
                          }`}
                        >
                          {Icon && style ? (
                            <Tooltip content={style.label}>
                              <span>
                                <Icon className={`mx-auto h-4 w-4 ${style.className}`} />
                                <span className="sr-only">{style.label}</span>
                              </span>
                            </Tooltip>
                          ) : (
                            <Tooltip content="Not yet marked for this session">
                              <span className="text-os-grey/50">
                                ·
                              </span>
                            </Tooltip>
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
                              ? "text-os-grey"
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
      <p className="text-sm text-os-grey">
        Completion is attendance-based — assignment scores are informational only and do not gate
        course completion.
      </p>
      <div className="overflow-x-auto rounded-os-card bg-os-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-os-container">
              <th className="sticky left-0 z-10 bg-os-card px-5 py-3 text-left font-medium text-os-grey">
                Student
              </th>
              <th className="whitespace-nowrap px-3 py-3 text-right font-medium text-os-grey">
                <span className="inline-flex items-center gap-1">
                  Attendance %
                  <InfoTip
                    content="Present + excused sessions as a percentage of total. Green ≥ 80%, amber 50–79%, red < 50%."
                    placement="top"
                  />
                </span>
              </th>
              {assignments.map((a) => (
                <Tooltip key={a.id} content={a.title}>
                  <th
                    className="max-w-[120px] px-3 py-3 text-center font-medium text-os-grey"
                  >
                    <span className="block truncate max-w-[120px]">{a.title}</span>
                    {a.points != null && (
                      <span className="block text-[10px] font-normal">/{a.points} pts</span>
                    )}
                  </th>
                </Tooltip>
              ))}
              <th className="whitespace-nowrap px-5 py-3 text-center font-medium text-os-grey">
                <span className="inline-flex items-center gap-1">
                  Completion
                  <InfoTip
                    content="Eligible means the student met the offering's attendance threshold (usually 80%). Assignment scores don't affect completion — only attendance does."
                    placement="top"
                  />
                </span>
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
                <tr key={st.applicationId} className="hover:bg-os-well/60">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-os-card px-5 py-2.5 font-medium text-foreground">
                    {st.name}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    <span
                      className={
                        pct >= 80
                          ? "text-accent-green"
                          : pct >= 50
                            ? "text-os-grey"
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
                      <Tooltip key={a.id} content={display === "—" ? "No submission" : display}>
                        <td
                          className="px-3 py-2.5 text-center tabular-nums text-os-grey"
                        >
                          {display}
                        </td>
                      </Tooltip>
                    );
                  })}
                  <td className="px-4 py-2 text-center">
                    {eligible ? (
                      <span className="inline-flex items-center gap-1 text-accent-green text-xs font-semibold">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        Eligible
                      </span>
                    ) : (
                      <span className="text-sm text-os-grey">Below threshold</span>
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
      className="os-form rounded-os-card bg-os-card"
    >
      <input type="hidden" name="intent" value="save-attendance" />
      <input type="hidden" name="sessionId" value={sessionId} />
      <div className="flex items-center justify-between gap-3 border-b border-os-container px-5 py-3">
        <span className="text-sm text-os-grey">
          Tap a student&apos;s answer, then save.
        </span>
        <button
          type="button"
          onClick={(e) => {
            const form = e.currentTarget.closest("form");
            form
              ?.querySelectorAll<HTMLInputElement>('input[value="Present"]')
              .forEach((el) => {
                el.checked = true;
              });
          }}
          className="text-sm font-medium text-os-accent hover:underline"
        >
          Mark all present
        </button>
      </div>
      <ul>
        {students.map((st) => (
          <li
            key={st.applicationId}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-os-container px-5 py-3 last:border-0"
          >
            <span className="text-sm text-foreground">{st.name}</span>
            {/* One tap per student. A four-option dropdown each meant open,
                aim, pick, repeat for a whole room — the three answers are
                short enough to just be buttons, and "unmarked" is simply the
                state you leave alone. */}
            <fieldset className="flex shrink-0 gap-1 rounded-os-item bg-os-well p-1">
              <legend className="sr-only">Attendance for {st.name}</legend>
              {MARK_CHOICES.map((choice) => (
                <label
                  key={choice}
                  className="relative cursor-pointer select-none text-sm"
                >
                  <input
                    type="radio"
                    name={`mark-${st.applicationId}`}
                    value={choice}
                    defaultChecked={st.marks[sessionId] === choice}
                    className="peer sr-only"
                  />
                  <span className="block rounded-os-item px-3.5 py-1.5 font-medium text-os-grey transition-colors peer-checked:bg-os-accent peer-checked:text-os-card peer-focus-visible:ring-2 peer-focus-visible:ring-os-accent/40">
                    {choice}
                  </span>
                </label>
              ))}
            </fieldset>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-os-container px-5 py-4">
        <Button type="submit" size="sm">
          Save attendance
        </Button>
      </div>
    </Form>
  );
}
