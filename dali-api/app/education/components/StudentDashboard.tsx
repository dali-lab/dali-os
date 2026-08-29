import { Link } from "react-router";
import { buttonClasses } from "~/components/ui/Button";
import { formatDateTime, formatSessionWhen } from "~/lib/display";

// The thin "what's next" shell at the top of the /education landing: open
// session check-ins and unsubmitted work that need the student now, then their
// enrolled courses with progress. Cross-course, action-first — the same pattern
// Blackboard Ultra's Activity stream and Google Classroom's To-do use (see
// specs/education-student-ui.md). Link paths are injected so the member and
// portal landings can point at their own routes.

export type StudentDashboardData = {
  openCheckIns: {
    sessionId: string;
    offeringTitle: string;
    sessionLabel: string;
    datetime: string | Date;
    endsAt: string | Date | null;
  }[];
  dueSoon: {
    assignmentId: string;
    offeringId: string | null;
    offeringTitle: string;
    title: string;
    dueAt: string | Date | null;
  }[];
  myCourses: {
    offeringId: string;
    title: string;
    type: string;
    attended: number;
    total: number;
    nextSessionAt: string | Date | null;
    isPast: boolean;
  }[];
};

export type StudentDashboardPaths = {
  course: (offeringId: string) => string;
  checkIn: (sessionId: string) => string;
  assignment: (offeringId: string, assignmentId: string) => string;
};

export function StudentDashboard({
  dashboard,
  paths,
  tz,
}: {
  dashboard: StudentDashboardData;
  paths: StudentDashboardPaths;
  tz: string;
}) {
  const { openCheckIns, dueSoon, myCourses } = dashboard;
  const active = myCourses.filter((c) => !c.isPast);
  const hasNext = openCheckIns.length > 0 || dueSoon.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {hasNext && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            What&apos;s next
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {openCheckIns.map((c) => (
              <li
                key={c.sessionId}
                className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Check in — {c.sessionLabel}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.offeringTitle} · {formatSessionWhen(c.datetime, c.endsAt, tz)}
                  </p>
                </div>
                <Link to={paths.checkIn(c.sessionId)} className={buttonClasses("primary", "sm")}>
                  Check in
                </Link>
              </li>
            ))}
            {dueSoon.slice(0, 6).map((a) => {
              const overdue = a.dueAt != null && new Date(a.dueAt) < new Date();
              return (
                <li
                  key={a.assignmentId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">☐ {a.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.offeringTitle} ·{" "}
                      <span className={overdue ? "font-medium text-red-600" : ""}>
                        {a.dueAt ? `due ${formatDateTime(a.dueAt, tz)}` : "no due date"}
                      </span>
                    </p>
                  </div>
                  {a.offeringId && (
                    <Link
                      to={paths.assignment(a.offeringId, a.assignmentId)}
                      className={buttonClasses("secondary", "sm")}
                    >
                      Open
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {active.length > 0 && (
        <section>
          <h2 className="mb-2 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            My courses
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((c) => {
              const pct = c.total > 0 ? Math.round((c.attended / c.total) * 100) : 0;
              return (
                <Link
                  key={c.offeringId}
                  to={paths.course(c.offeringId)}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:border-accent-coral/50"
                >
                  <div>
                    <p className="font-heading font-semibold text-foreground">{c.title}</p>
                    <p className="text-xs text-muted-foreground">{c.type}</p>
                  </div>
                  {c.total > 0 ? (
                    <div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-accent-teal"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.attended}/{c.total} sessions attended
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No sessions scheduled yet</p>
                  )}
                  {c.nextSessionAt && (
                    <p className="text-xs text-accent-coral">
                      Next session {formatDateTime(c.nextSessionAt, tz)}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
