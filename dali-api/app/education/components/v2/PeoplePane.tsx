import { useState } from "react";
import { Form, Link } from "react-router";
import { Button } from "~/components/ui/Button";
import { ApplicationsReview } from "~/education/components/ApplicationsReview";
import { RosterMatrix } from "~/education/components/RosterMatrix";
import { MyStatusChip } from "~/education/components/OfferingCard";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { cn } from "~/lib/cn";

const STATUS_FILTERS = ["All", "Submitted", "Approved", "Waitlisted", "Rejected", "Withdrawn"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export type PeoplePaneProps = {
  offeringId: string;
  basePath: string;
  showBackLink?: boolean;
  applications: {
    id: string;
    status: string;
    submittedAt: string | Date | null;
    waitlistRank: number | null;
    applicant: {
      id: string;
      firstName: string;
      lastName: string;
      daliEmail: string | null;
      dartmouthEmail: string | null;
      netId: string | null;
    };
    formSubmission: {
      answers: unknown;
      formVersion: { questions: unknown };
    } | null;
    note: { feedback: string | null; internalNote: string | null } | null;
  }[];
  attendanceMatrix: {
    sessions: { id: string; sequence: number; datetime: string | Date }[];
    students: {
      applicationId: string;
      name: string;
      marks: Record<string, "Present" | "Absent" | "Excused">;
      attended: number;
    }[];
  };
  assignmentsForPerformance: { id: string; title: string; points: number | null }[];
  submissionsByApp: Record<string, Record<string, { score: number | null; grade: string | null }>>;
  completionByApp: Record<string, boolean>;
  bulkApproveResult?: { approved: number; skipped: number } | null;
};

export function PeoplePane({
  offeringId,
  basePath,
  showBackLink = true,
  applications,
  attendanceMatrix,
  assignmentsForPerformance,
  submissionsByApp,
  completionByApp,
  bulkApproveResult,
}: PeoplePaneProps) {
  const tz = useUserTimeZone();
  const [appFilter, setAppFilter] = useState<StatusFilter>("All");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    attendanceMatrix.sessions[0]?.id ?? null,
  );

  const appCounts = applications.reduce<Record<string, number>>((m, a) => {
    m[a.status] = (m[a.status] ?? 0) + 1;
    return m;
  }, {});

  const filteredApps =
    appFilter === "All"
      ? applications
      : applications.filter((a) => a.status === appFilter);

  const pendingCount = appCounts["Submitted"] ?? 0;

  return (
    <div className="flex flex-col gap-6">
      {showBackLink && (
        <header className="flex items-center gap-3">
          <Link
            to={`${basePath}/hub`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Course hub
          </Link>
        </header>
      )}

      <h1 className="font-heading text-2xl font-bold text-foreground">People</h1>

      {bulkApproveResult && (
        <p className="text-sm text-foreground bg-green-50 border border-green-200 rounded-md px-3 py-2">
          Approved {bulkApproveResult.approved} pending application
          {bulkApproveResult.approved === 1 ? "" : "s"}
          {bulkApproveResult.skipped > 0 &&
            ` — ${bulkApproveResult.skipped} left (capacity reached)`}
          .
        </p>
      )}

      {/* ── Applications section ─────────────────────────────── */}
      <section className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.filter(
            (s) => s === "All" || (appCounts[s] ?? 0) > 0,
          ).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setAppFilter(s)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                appFilter === s
                  ? "bg-accent-coral text-white"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "All"
                ? `All ${applications.length}`
                : `${s} ${appCounts[s] ?? 0}`}
            </button>
          ))}

          {pendingCount > 0 && (
            <Form method="post" className="ml-auto">
              <input type="hidden" name="intent" value="approve-all-pending" />
              <Button type="submit" size="sm">
                Approve all {pendingCount} pending
              </Button>
            </Form>
          )}
        </div>

        {applications.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No applications yet.</p>
        ) : (
          <ApplicationsReview
            applications={filteredApps}
            statusChip={(status) => <MyStatusChip status={status as never} />}
            formatSubmitted={(at) => formatDateTime(at as never, tz)}
          />
        )}
      </section>

      {/* ── Roster & performance section ─────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Roster &amp; performance
        </h2>
        <RosterMatrix
          sessions={attendanceMatrix.sessions.map((s) => ({
            id: s.id,
            sequence: s.sequence,
            datetime: s.datetime,
          }))}
          students={attendanceMatrix.students}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          formatSessionDate={(d) => formatDateTime(d as never, tz)}
          assignments={assignmentsForPerformance}
          submissionsByApp={submissionsByApp}
          completionByApp={completionByApp}
        />
      </section>
    </div>
  );
}
