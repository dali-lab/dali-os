import { DocEditor, countWords } from "~/components/doc";
import { cn } from "~/lib/cn";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { AssignmentWorkArea } from "~/education/components/AssignmentWorkArea";
import type { AssignmentView, SubmissionView } from "~/education/components/AssignmentWorkArea";
import {
  InstructorGradingPane,
  type InstructorSubmission,
} from "./InstructorGradingPane";

// Instructor payload assembled by the v2 member assignment route loader.
export type InstructorPayload = {
  submissions: InstructorSubmission[];
  enrolledCount: number;
  toGrade: number;
  collabToken: string | null;
};

type Props = {
  assignment: AssignmentView;
  submission: SubmissionView;
  canSubmit: boolean;
  isManager: boolean;
  /** basePath = "/education" (member) or "/portal/education" (portal). */
  basePath: string;
  collabToken: string | null;
  userName: string;
  offeringId: string;
  /** Populated only when isManager=true on the member route (not portal). */
  instructorPayload: InstructorPayload | null;
};

export function AssignmentScreenV2({
  assignment,
  submission,
  canSubmit,
  isManager,
  basePath,
  collabToken,
  userName,
  offeringId,
  instructorPayload,
}: Props) {
  const tz = useUserTimeZone();
  const pastDue =
    assignment.dueAt != null && new Date(assignment.dueAt) < new Date();

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* ── Shared header ──────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-1.5">
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {assignment.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {assignment.dueAt ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                pastDue
                  ? "border-accent-coral/30 bg-accent-coral/10 text-accent-coral"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              Due {formatDateTime(assignment.dueAt, tz)}
              {assignment.points != null
                ? ` · ${assignment.points} pts`
                : ""}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              No due date
              {assignment.points != null
                ? ` · ${assignment.points} pts`
                : ""}
            </span>
          )}
        </div>
      </header>

      {/* ── Instructions block ─────────────────────────────────────────────── */}
      {countWords(assignment.instructionsContent) > 0 && (
        <section className="bg-card border border-border rounded-lg p-5">
          <DocEditor
            features="notes"
            editable={false}
            initialContent={assignment.instructionsContent}
          />
        </section>
      )}

      {/* ── Instructor lens ──────────────────────────────────────────────────
          Only rendered in the member route when the viewer is a manager AND
          instructorPayload is present. Portal route always passes null.
      ──────────────────────────────────────────────────────────────────────── */}
      {isManager && instructorPayload ? (
        <InstructorGradingPane
          assignment={assignment}
          submissions={instructorPayload.submissions}
          enrolledCount={instructorPayload.enrolledCount}
          toGrade={instructorPayload.toGrade}
          collabToken={instructorPayload.collabToken}
          userName={userName}
          offeringId={offeringId}
        />
      ) : (
        /* ── Student lens ────────────────────────────────────────────────── */
        <AssignmentWorkArea
          assignment={assignment}
          submission={submission}
          canSubmit={canSubmit}
          collabToken={collabToken}
          userName={userName}
        />
      )}
    </div>
  );
}
