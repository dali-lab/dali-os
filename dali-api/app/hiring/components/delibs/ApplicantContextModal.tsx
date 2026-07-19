import { useFetcher } from "react-router";
import { CollaborativeEditor } from "~/components/CollaborativeEditor";
import { Modal } from "~/components/Modal";
import {
  DECISION_COLORS,
  RECOMMENDATION_COLORS,
  STAGE_LABELS,
} from "~/hiring/lib/labels";
import { useEffect } from "react";

export interface ApplicantContextModalProps {
  domainApplicationId: string;
  onClose: () => void;
  /**
   * When `editable` is true and a `collabToken` is supplied, the interview-prep
   * note renders as a live collaborative editor (Initial delibs). Otherwise the
   * note is shown read-only, and hidden entirely when empty.
   */
  collabToken?: string | null;
  userName?: string;
  editable?: boolean;
}

export function ApplicantContextModal({
  domainApplicationId,
  onClose,
  collabToken,
  userName,
  editable = false,
}: ApplicantContextModalProps) {
  const fetcher = useFetcher();

  useEffect(() => {
    fetcher.load(`/api/hiring/domain-applications/${domainApplicationId}/full-context`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainApplicationId]);

  const data = fetcher.data as any;
  const isError = data && typeof data === "object" && "error" in data;
  const isLoading = fetcher.state === "loading" || (!data && !isError);

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="applicant-context-title"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
      containerClassName="bg-card rounded-xl shadow-xl w-full max-w-5xl my-8 max-h-[90vh] flex flex-col"
    >
      <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card rounded-t-xl flex-shrink-0">
        <div>
          {isLoading || isError || !data ? (
            <h2 id="applicant-context-title" className="text-lg font-semibold text-foreground">
              Applicant Context
            </h2>
          ) : (
            <>
              <h2 id="applicant-context-title" className="text-lg font-semibold text-foreground">
                {data.application.applicant.firstName} {data.application.applicant.lastName}
              </h2>
              <p className="text-xs text-muted-foreground">
                {data.domainApplication.domain?.name ?? ""}
                {data.decisions?.length > 0 && (
                  <>
                    {" · "}
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        DECISION_COLORS[data.decisions[0].type] ?? "bg-muted text-foreground/80"
                      }`}
                    >
                      {data.decisions[0].type} ({STAGE_LABELS[data.decisions[0].stage] ?? data.decisions[0].stage})
                    </span>
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col p-6 gap-6">
          <InterviewPrepNoteSection
            domainApplicationId={domainApplicationId}
            editable={editable}
            collabToken={collabToken}
            userName={userName}
            note={data?.domainApplication?.interviewPrepNote ?? null}
          />

          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading applicant context…</p>
          )}
          {isError && (
            <p className="text-sm text-red-600">
              Failed to load applicant context: {data.error ?? "unknown error"}
            </p>
          )}

          {!isLoading && !isError && data && (
            // Each column scrolls independently so scrolling is predictable:
            // whichever side the cursor is over moves, the other stays put.
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left: application answers */}
              <div className="lg:col-span-2 min-h-0 lg:overflow-y-auto space-y-6 pr-1">
                <AnswerSection
                  title="General Application"
                  questions={data.application.generalQuestions}
                  answers={data.application.answers}
                />
                <AnswerSection
                  title={`${data.domainApplication.domain?.name ?? "Domain"} Challenge`}
                  questions={data.domainApplication.challengeQuestions}
                  answers={data.domainApplication.answers}
                />
              </div>

              {/* Right: review + interview + decision data */}
              <div className="min-h-0 lg:overflow-y-auto space-y-6 pr-1">
                <ReviewsSection
                  reviews={data.reviews ?? []}
                  criteriaByKey={data.criteriaByKey ?? {}}
                  fieldContext={buildFieldContext(data)}
                />
                <InterviewSection interview={data.interviews?.[0] ?? null} />
                <DecisionsSection decisions={data.decisions ?? []} />
              </div>
            </div>
          )}
        </div>
    </Modal>
  );
}

export function InterviewPrepNoteSection({
  domainApplicationId,
  editable,
  collabToken,
  userName,
  note,
}: {
  domainApplicationId: string;
  editable: boolean;
  collabToken?: string | null;
  userName?: string;
  note: string | null;
}) {
  const title = "Interview Prep Note";
  const description = "Specific things to bring up in the interview.";

  if (editable) {
    return (
      <section className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <div className="p-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            {description} Edited live with other leads; shown to interviewers.
          </p>
          {collabToken && userName ? (
            <CollaborativeEditor
              editorId="prep-note"
              documentName={`domainApplication:${domainApplicationId}:prepNote`}
              token={collabToken}
              userName={userName}
              placeholder="Specific things to bring up in the interview…"
            />
          ) : (
            <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200 text-sm text-yellow-800">
              Session expired — please refresh to enable collaborative editing.
            </div>
          )}
        </div>
      </section>
    );
  }

  // Read-only contexts (e.g. Final delibs, reviewer view): show the synced
  // plaintext if present, otherwise hide the section entirely.
  if (!note || note.trim().length === 0) return null;

  return (
    <section className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-muted/50 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-4">
        <p className="text-sm text-foreground bg-muted/50 rounded p-3 whitespace-pre-wrap">
          {note}
        </p>
      </div>
    </section>
  );
}

function AnswerSection({
  title,
  questions,
  answers,
}: {
  title: string;
  questions: any;
  answers: any;
}) {
  const qs = (Array.isArray(questions) ? questions : []) as Array<{
    key: string;
    data: { label: string };
  }>;
  const a = (answers && typeof answers === "object" ? answers : {}) as Record<string, unknown>;

  if (qs.length === 0 && Object.keys(a).length === 0) return null;

  return (
    <section className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-muted/50 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-4 space-y-4">
        {qs.length > 0
          ? qs.map((q) => {
              const value = a[q.key];
              return (
                <div key={q.key}>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    {q.data?.label ?? q.key}
                  </div>
                  <div className="text-sm text-foreground bg-muted/50 rounded p-3 whitespace-pre-wrap">
                    {value ? String(value) : (
                      <span className="text-muted-foreground/70 italic">No answer provided</span>
                    )}
                  </div>
                </div>
              );
            })
          : Object.entries(a).map(([key, value]) => (
              <div key={key}>
                <div className="text-xs font-medium text-muted-foreground mb-1">{key}</div>
                <div className="text-sm text-foreground bg-muted/50 rounded p-3 whitespace-pre-wrap">
                  {String(value ?? "")}
                </div>
              </div>
            ))}
      </div>
    </section>
  );
}

type FieldContext = Record<string, { label: string; answer: string }>;

function buildFieldContext(data: any): FieldContext {
  const ctx: FieldContext = {};
  const generalQs = Array.isArray(data?.application?.generalQuestions)
    ? data.application.generalQuestions
    : [];
  const generalAns = (data?.application?.answers && typeof data.application.answers === "object")
    ? (data.application.answers as Record<string, unknown>)
    : {};
  const domainQs = Array.isArray(data?.domainApplication?.challengeQuestions)
    ? data.domainApplication.challengeQuestions
    : [];
  const domainAns = (data?.domainApplication?.answers && typeof data.domainApplication.answers === "object")
    ? (data.domainApplication.answers as Record<string, unknown>)
    : {};
  for (const q of generalQs) {
    ctx[q.key] = {
      label: q.data?.label ?? q.key,
      answer: typeof generalAns[q.key] === "string" ? (generalAns[q.key] as string) : "",
    };
  }
  for (const q of domainQs) {
    ctx[q.key] = {
      label: q.data?.label ?? q.key,
      answer: typeof domainAns[q.key] === "string" ? (domainAns[q.key] as string) : "",
    };
  }
  return ctx;
}

function ReviewAnnotations({
  annotations,
  fieldContext,
}: {
  annotations: Array<{ id: string; fieldKey: string; start: number; end: number; comment: string }>;
  fieldContext: FieldContext;
}) {
  if (!annotations.length) return null;
  // Group annotations by field so each section reads cleanly.
  const byField = new Map<string, typeof annotations>();
  for (const a of annotations) {
    const list = byField.get(a.fieldKey) ?? [];
    list.push(a);
    byField.set(a.fieldKey, list);
  }
  return (
    <div className="mt-2 space-y-2">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70">
        Notes
      </div>
      {Array.from(byField.entries()).map(([fieldKey, anns]) => {
        const ctx = fieldContext[fieldKey];
        const label = ctx?.label ?? fieldKey;
        const answer = ctx?.answer ?? "";
        return (
          <div key={fieldKey} className="text-xs">
            <div className="font-medium text-foreground/80 mb-1">{label}</div>
            <ul className="space-y-1.5">
              {anns.map((a) => {
                const excerpt = answer
                  ? answer.slice(Math.max(0, a.start), Math.max(a.start, a.end))
                  : "";
                return (
                  <li key={a.id} className="bg-yellow-50 border-l-2 border-yellow-300 rounded-r p-2">
                    {excerpt && (
                      <div className="italic text-muted-foreground mb-1 whitespace-pre-wrap">
                        “{excerpt}”
                      </div>
                    )}
                    {a.comment && (
                      <div className="text-foreground whitespace-pre-wrap">{a.comment}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function ReviewsSection({
  reviews,
  criteriaByKey,
  fieldContext,
}: {
  reviews: any[];
  criteriaByKey: Record<string, { label: string; maxScore?: number }>;
  fieldContext: FieldContext;
}) {
  return (
    <section className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-muted/50 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">
          Reviews ({reviews.filter((r) => r.submittedAt).length}/{reviews.length})
        </h3>
      </div>
      {reviews.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground/70">
          No reviewers assigned yet.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {reviews.map((review) => {
            const reviewer = review.cycleReviewer?.user;
            const name = reviewer ? `${reviewer.firstName} ${reviewer.lastName}` : "Unknown";
            const isSubmitted = !!review.submittedAt;
            const scores = (review.scores ?? {}) as Record<string, number>;
            return (
              <div key={review.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{name}</span>
                    {isSubmitted ? (
                      <span className="text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded font-medium">
                        Submitted
                      </span>
                    ) : (
                      <span className="text-xs text-yellow-700 bg-yellow-100 px-1.5 py-0.5 rounded font-medium">
                        In Progress
                      </span>
                    )}
                  </div>
                  {review.overallRecommendation && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        RECOMMENDATION_COLORS[review.overallRecommendation] ??
                        "bg-muted text-foreground/80"
                      }`}
                    >
                      {review.overallRecommendation}
                    </span>
                  )}
                </div>

                {Object.keys(scores).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(scores).map(([key, score]) => {
                      if (score == null) return null;
                      const meta = criteriaByKey[key];
                      const label = meta?.label ?? key;
                      return (
                        <span
                          key={key}
                          className="text-xs bg-muted text-foreground/80 px-1.5 py-0.5 rounded"
                          title={label}
                        >
                          {label.split(" ")[0]}: {score}
                          {meta?.maxScore != null ? `/${meta.maxScore}` : ""}
                        </span>
                      );
                    })}
                  </div>
                )}

                <div className="mt-2">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70 mb-1">
                    Internal Feedback
                  </div>
                  {review.feedback ? (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2 whitespace-pre-wrap">
                      {review.feedback}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground/70 italic">
                      No internal feedback provided
                    </p>
                  )}
                </div>
                <div className="mt-2">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70 mb-1">
                    Rejection Rationale
                  </div>
                  {review.rejectionRationale ? (
                    <p className="text-xs text-red-600 bg-red-50 rounded p-2 whitespace-pre-wrap">
                      {review.rejectionRationale}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground/70 italic">
                      No rejection rationale provided
                    </p>
                  )}
                </div>
                <ReviewAnnotations
                  annotations={Array.isArray(review.annotations) ? review.annotations : []}
                  fieldContext={fieldContext}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function InterviewSection({ interview }: { interview: any | null }) {
  if (!interview) return null;
  const assignments: any[] = Array.isArray(interview.assignments) ? interview.assignments : [];
  return (
    <section className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-muted/50 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Interview</h3>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {new Date(interview.startTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
            {new Date(interview.startTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              interview.status === "Completed"
                ? "bg-green-100 text-green-700"
                : "bg-blue-100 text-blue-700"
            }`}
          >
            {interview.status}
          </span>
        </div>
        {interview.recommendation && (
          <div className="text-sm">
            <span className="text-muted-foreground">Recommendation:</span>{" "}
            <span className="font-medium text-foreground">{interview.recommendation}</span>
          </div>
        )}
        {interview.recommendationNotes && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2 whitespace-pre-wrap">
            {interview.recommendationNotes}
          </p>
        )}
        {assignments.length > 0 && (
          <div className="text-xs text-muted-foreground pt-1">
            Interviewers:{" "}
            {assignments
              .map((a) => {
                const m = a.cycleInterviewer?.user;
                return m ? `${m.firstName} ${m.lastName}` : "?";
              })
              .join(", ")}
          </div>
        )}

        {/* Joint interview notes (shared by interviewers). */}
        <div className="pt-2 border-t border-border">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70 mb-1">
            Interview notes
          </div>
          {interview.jointNotes ? (
            <p className="text-sm text-foreground whitespace-pre-wrap">{interview.jointNotes}</p>
          ) : (
            <p className="text-xs text-muted-foreground/70 italic">No interview notes.</p>
          )}
        </div>

        {/* Per-interviewer recommendation notes, when present. */}
        {assignments.some((a) => a.recNotes) && (
          <div className="pt-2 space-y-2">
            {assignments
              .filter((a) => a.recNotes)
              .map((a) => {
                const m = a.cycleInterviewer?.user;
                const who = m ? `${m.firstName} ${m.lastName}` : "Interviewer";
                return (
                  <div key={a.id}>
                    <div className="text-xs font-medium text-muted-foreground">
                      {who}&rsquo;s notes
                    </div>
                    <p className="mt-0.5 text-sm text-foreground whitespace-pre-wrap">
                      {a.recNotes}
                    </p>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </section>
  );
}

function DecisionsSection({ decisions }: { decisions: any[] }) {
  if (decisions.length === 0) return null;
  return (
    <section className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-muted/50 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Decision History</h3>
      </div>
      <div className="px-4 py-3 space-y-2">
        {decisions.map((d) => (
          <div key={d.id} className="text-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    DECISION_COLORS[d.type] ?? "bg-muted text-foreground/80"
                  }`}
                >
                  {d.type}
                </span>
                <span className="text-xs text-muted-foreground">
                  {STAGE_LABELS[d.stage] ?? d.stage}
                </span>
                {d.madeBy && (
                  <span className="text-xs text-muted-foreground/70">
                    by {d.madeBy.firstName} {d.madeBy.lastName}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground/70">
                {new Date(d.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
            {d.notes && (
              <p className="mt-1 text-xs text-muted-foreground bg-muted/50 rounded p-2 whitespace-pre-wrap">
                {d.notes}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
