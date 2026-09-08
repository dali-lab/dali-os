import { useState } from "react";
import { Form } from "react-router";
import { Check, Pencil } from "lucide-react";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { SubmissionDisplay, type SubmissionArtifact } from "./SubmissionDisplay";

// Submission row as produced by listSubmissions + readDocAsBlocks, passed from
// the v2 assignment route's instructorPayload.
export type InstructorSubmission = {
  id: string;
  textContent: string | null;
  files: { key: string; name: string }[];
  link?: string | null;
  docContent?: unknown;
  submittedAt: string | Date | null;
  gradedAt: string | Date | null;
  grade: string | null;
  score?: number | null;
  student: { id: string; firstName: string | null; lastName: string | null };
};

type Assignment = {
  id: string;
  title: string;
  dueAt: string | Date | null;
  submissionType: "Text" | "File" | "Mixed" | "Link" | "Complete" | "Doc";
  points?: number | null;
};

export function InstructorGradingPane({
  assignment,
  submissions,
  enrolledCount,
  toGrade,
  collabToken,
  userName,
  offeringId,
}: {
  assignment: Assignment;
  submissions: InstructorSubmission[];
  enrolledCount: number;
  toGrade: number;
  collabToken: string | null;
  userName: string;
  offeringId: string;
}) {
  const tz = useUserTimeZone();
  const [selectedId, setSelectedId] = useState<string | null>(
    submissions[0]?.id ?? null,
  );
  const [editOpen, setEditOpen] = useState(false);
  const confirmSubmit = useConfirmSubmit();

  const selected = submissions.find((s) => s.id === selectedId) ?? null;

  const submittedCount = submissions.filter((s) => s.submittedAt).length;

  return (
    <div className="flex gap-0 border border-border rounded-lg overflow-hidden bg-card">
      {/* Left rail — student picker */}
      <div className="w-56 shrink-0 border-r border-border flex flex-col">
        <div className="px-3 py-2.5 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground">
            {submittedCount} in · {toGrade} to grade
          </p>
          <p className="text-xs text-muted-foreground">
            {enrolledCount} enrolled
          </p>
        </div>
        {submissions.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground italic">
            No submissions yet.
          </p>
        ) : (
          <ul className="flex flex-col overflow-y-auto">
            {submissions.map((s) => {
              const name =
                `${s.student.firstName ?? ""} ${s.student.lastName ?? ""}`.trim() ||
                "Student";
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors",
                      s.id === selectedId
                        ? "bg-foreground/5"
                        : "hover:bg-foreground/5",
                    )}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-foreground truncate">
                        {name}
                      </span>
                      {s.submittedAt && (
                        <span className="block text-xs text-muted-foreground truncate">
                          {formatDateTime(s.submittedAt, tz)}
                        </span>
                      )}
                      {!s.submittedAt && (
                        <span className="block text-xs text-muted-foreground italic">
                          Not submitted
                        </span>
                      )}
                    </span>
                    {s.gradedAt && (
                      <Check
                        className="shrink-0 text-accent-teal"
                        size={14}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Right panel — selected student */}
      <div className="flex-1 min-w-0 flex flex-col">
        {selected == null ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground italic">
              No submissions yet.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-4 overflow-y-auto">
            {/* Student header */}
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-foreground">
                {`${selected.student.firstName ?? ""} ${selected.student.lastName ?? ""}`.trim()}
              </p>
              <p className="text-xs text-muted-foreground">
                {selected.submittedAt
                  ? `Submitted ${formatDateTime(selected.submittedAt, tz)}`
                  : "Not submitted"}
                {selected.gradedAt
                  ? ` · Graded ${formatDateTime(selected.gradedAt, tz)}`
                  : ""}
              </p>
            </div>

            {/* Submission artifact */}
            <SubmissionDisplay
              submission={{
                textContent: selected.textContent,
                files: selected.files,
                link: selected.link,
                docContent: selected.docContent,
                submittedAt: selected.submittedAt,
                submissionType: assignment.submissionType,
              } as SubmissionArtifact}
            />

            {/* Feedback collab doc */}
            <div className="border-t border-border pt-3 flex flex-col gap-3">
              <p className="text-xs font-semibold text-muted-foreground">
                Feedback (shown to the student once graded — saves as you type)
              </p>
              {collabToken ? (
                <PresenceProvider
                  pageId={`edusubmission:${selected.id}`}
                  token={collabToken}
                  userName={userName}
                >
                  <DocEditor
                    features="notes"
                    collab={{
                      documentName: `edusubmission:${selected.id}:feedback`,
                      token: collabToken,
                      userName,
                    }}
                    placeholder="Nice work — consider…"
                    className="border border-border rounded-md"
                  />
                </PresenceProvider>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Sign in again to edit feedback.
                </p>
              )}

              {/* Grade form */}
              <Form method="post" className="flex items-end gap-3 flex-wrap">
                <input type="hidden" name="intent" value="grade-submission" />
                <input type="hidden" name="submissionId" value={selected.id} />
                {assignment.points != null && (
                  <label className="block">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Score (out of {assignment.points})
                    </span>
                    <input
                      type="number"
                      name="score"
                      min={0}
                      max={assignment.points}
                      defaultValue={selected.score ?? ""}
                      placeholder="—"
                      className="mt-1 w-24 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Grade
                  </span>
                  <input
                    type="text"
                    name="grade"
                    defaultValue={selected.grade ?? ""}
                    placeholder="Complete"
                    className="mt-1 w-40 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                  />
                </label>
                <Button type="submit" variant="secondary" size="sm">
                  {selected.gradedAt ? "Update grade" : "Release grade"}
                </Button>
              </Form>
            </div>

            {/* Edit setup disclosure */}
            <div className="border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setEditOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil size={12} />
                {editOpen ? "Hide setup" : "Edit setup"}
              </button>
              {editOpen && (
                <div className="mt-3 flex flex-col gap-4">
                  <Form method="post" className="flex flex-col gap-3">
                    <input type="hidden" name="intent" value="update-assignment" />
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Title
                      </span>
                      <input
                        type="text"
                        name="title"
                        defaultValue={assignment.title}
                        required
                        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Due date/time
                      </span>
                      <input
                        type="datetime-local"
                        name="dueAt"
                        defaultValue={
                          assignment.dueAt
                            ? new Date(assignment.dueAt)
                                .toISOString()
                                .slice(0, 16)
                            : ""
                        }
                        className="mt-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Submission type
                      </span>
                      <select
                        name="submissionType"
                        defaultValue={assignment.submissionType}
                        className="mt-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                      >
                        {(
                          [
                            "Text",
                            "File",
                            "Mixed",
                            "Link",
                            "Complete",
                            "Doc",
                          ] as const
                        ).map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Points (blank = complete/incomplete)
                      </span>
                      <input
                        type="number"
                        name="points"
                        min={1}
                        defaultValue={assignment.points ?? ""}
                        placeholder="—"
                        className="mt-1 w-24 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                      />
                    </label>
                    <div>
                      <Button type="submit" variant="secondary" size="sm">
                        Save changes
                      </Button>
                    </div>
                  </Form>

                  <Form
                    method="post"
                    onSubmit={confirmSubmit({
                      title: "Delete this assignment?",
                      description:
                        "This can't be undone. Assignments with existing submissions can't be deleted.",
                      confirmLabel: "Delete",
                      tone: "destructive",
                    })}
                  >
                    <input type="hidden" name="intent" value="delete-assignment" />
                    <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                      Delete assignment
                    </Button>
                  </Form>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
