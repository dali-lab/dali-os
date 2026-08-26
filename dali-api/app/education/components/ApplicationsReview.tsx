import { useEffect, useRef, useState } from "react";
import { Form, useFetcher } from "react-router";
import { Button } from "~/components/ui/Button";
import { ApplicationAnswers } from "./ApplicationAnswers";
import type { Question } from "~/types";
import { InfoTip, Tooltip } from "~/components/ui/floating";

// Reviewing applications is a read-then-decide loop, so the list and the thing
// you're deciding on sit side by side: pick a name on the left, their answers
// fill the right. The old accordion made you expand one applicant at a time and
// pushed everyone below them down the page, which is the wrong shape for
// comparing candidates.

export type ReviewApplication = {
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
};

const DECISIONS = ["Approved", "Waitlisted", "Rejected"] as const;

function applicantName(a: ReviewApplication) {
  return `${a.applicant.firstName} ${a.applicant.lastName}`.trim();
}

function applicantEmail(a: ReviewApplication) {
  return (
    a.applicant.daliEmail ??
    a.applicant.dartmouthEmail ??
    (a.applicant.netId ? `${a.applicant.netId}@dartmouth.edu` : "")
  );
}

export function ApplicationsReview({
  applications,
  statusChip,
  formatSubmitted,
}: {
  applications: ReviewApplication[];
  /** The page's own status chip, passed in so the two stay identical. */
  statusChip: (status: string) => React.ReactNode;
  formatSubmitted: (at: string | Date | null) => string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    applications[0]?.id ?? null,
  );
  // Follow the list when the selection disappears (filtered out, or decided on
  // and moved) rather than showing an empty panel.
  const selected =
    applications.find((a) => a.id === selectedId) ?? applications[0] ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] items-start">
      <ul className="flex flex-col gap-1 rounded-lg border border-border bg-card p-1.5 lg:max-h-[70vh] lg:overflow-y-auto">
        {applications.map((a) => {
          const active = selected?.id === a.id;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setSelectedId(a.id)}
                aria-current={active ? "true" : undefined}
                className={`w-full rounded-md border-l-2 px-2.5 py-2 text-left transition-colors ${
                  active
                    ? "border-l-accent-coral bg-muted"
                    : "border-l-transparent hover:bg-muted/50"
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`truncate text-sm font-medium ${
                      active ? "text-accent-coral" : "text-foreground"
                    }`}
                  >
                    {applicantName(a)}
                  </span>
                  {a.status === "Waitlisted" && a.waitlistRank != null && (
                    <Tooltip
                      content={`Waitlist position ${a.waitlistRank}. If a seat opens before registration closes, they're automatically promoted to Enrolled in rank order.`}
                      variant="rich"
                      placement="top"
                    >
                      <span className="shrink-0 text-xs text-muted-foreground cursor-default">
                        #{a.waitlistRank}
                      </span>
                    </Tooltip>
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-2 min-w-0">
                  {statusChip(a.status)}
                  <span className="truncate text-xs text-muted-foreground">
                    {applicantEmail(a)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected ? (
        <ApplicationDetail
          key={selected.id}
          application={selected}
          statusChip={statusChip}
          formatSubmitted={formatSubmitted}
        />
      ) : (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground italic">
          Pick an applicant to read their responses.
        </p>
      )}
    </div>
  );
}

function ApplicationDetail({
  application: a,
  statusChip,
  formatSubmitted,
}: {
  application: ReviewApplication;
  statusChip: (status: string) => React.ReactNode;
  formatSubmitted: (at: string | Date | null) => string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold text-foreground">
            {applicantName(a)}
          </h3>
          <p className="text-xs text-muted-foreground">{applicantEmail(a)}</p>
        </div>
        <div className="flex items-center gap-2">
          {statusChip(a.status)}
          <span className="text-xs text-muted-foreground">
            {formatSubmitted(a.submittedAt)}
          </span>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        {a.formSubmission ? (
          <ApplicationAnswers
            questions={(a.formSubmission.formVersion.questions as Question[]) ?? []}
            answers={(a.formSubmission.answers as Record<string, unknown>) ?? {}}
          />
        ) : (
          <p className="text-xs text-muted-foreground italic">No answers recorded.</p>
        )}
      </div>

      <NotesFields application={a} />

      {/* Decisions sit last: you read the answers, write your note, then decide.
          Putting them above the notes asked for the verdict first. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {DECISIONS.filter((s) => s !== a.status).map((s) => (
          <Form key={s} method="post">
            <input type="hidden" name="intent" value="decide-application" />
            <input type="hidden" name="applicationId" value={a.id} />
            <input type="hidden" name="status" value={s} />
            <Button type="submit" size="sm" variant={s === "Approved" ? "primary" : "secondary"}>
              {s === "Approved" ? "Approve" : s === "Waitlisted" ? "Waitlist" : "Reject"}
            </Button>
          </Form>
        ))}
      </div>
    </div>
  );
}

/**
 * Feedback + internal note, saved on a debounce instead of behind a button.
 * A reviewer types a note and moves to the next applicant; a Save button there
 * is a step whose only job is to be forgotten.
 */
function NotesFields({ application: a }: { application: ReviewApplication }) {
  const fetcher = useFetcher();
  const [feedback, setFeedback] = useState(a.note?.feedback ?? "");
  const [internalNote, setInternalNote] = useState(a.note?.internalNote ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Skip the save that would otherwise fire from the initial mount.
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fetcher.submit(
        {
          intent: "save-student-note",
          applicationId: a.id,
          feedback,
          internalNote,
        },
        { method: "post" },
      );
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // fetcher identity changes each render; depending on it would re-arm the
    // timer forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, internalNote, a.id]);

  const saving = fetcher.state !== "idle";

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Notes</span>
        <span className="text-[11px] text-muted-foreground" aria-live="polite">
          {saving ? "Saving…" : dirty.current ? "Saved" : ""}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 items-start">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1">
            Feedback to student — shared with their certificate
            <InfoTip content="This note is visible to the student. It's included with their completion certificate and shown on their course page." />
          </span>
          <textarea
            rows={4}
            value={feedback}
            onChange={(e) => {
              dirty.current = true;
              setFeedback(e.target.value);
            }}
            placeholder="Overall performance feedback the student will see…"
            className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-amber-800 inline-flex items-center gap-1">
            Internal note — hiring only, never shown to the student
            <InfoTip content="Visible only to instructors and Core members. Used as a hiring signal when this student applies to DALI — the student never sees it." />
          </span>
          <textarea
            rows={4}
            value={internalNote}
            onChange={(e) => {
              dirty.current = true;
              setInternalNote(e.target.value);
            }}
            placeholder="Engagement/competency signal for future hiring…"
            className="mt-1 w-full rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm"
          />
        </label>
      </div>
    </div>
  );
}
