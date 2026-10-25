import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { Check, Minus, X } from "lucide-react";
import { DocEditor } from "~/components/doc";
import { Avatar } from "~/components/ui/Avatar";
import { buttonClasses } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { cn } from "~/lib/cn";
import { relativeTime } from "~/lib/relative-time";
import { LESSON_FEATURES } from "~/journeys/lib/doc-features";
import { evaluateCriteria, foundHotspots } from "~/journeys/lib/studio";
import type { ReviewEntry } from "~/journeys/lib/studio.server";
import { CanvasBoard } from "~/journeys/components/studio/canvas/CanvasBoard";

function StateIcon({ passed }: { passed: boolean }) {
  return passed ? (
    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-os-green text-os-bg" aria-label="Passed">
      <Check className="h-3 w-3" strokeWidth={3} />
    </span>
  ) : (
    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-os-container text-os-grey" aria-label="Not met">
      <Minus className="h-3 w-3" strokeWidth={3} />
    </span>
  );
}

/** One submission: the work beside the checks and the mentor's decision. */
export function ReviewDetail({ entry }: { entry: ReviewEntry }) {
  const { submission, studio, learner } = entry;
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [checks, setChecks] = useState<Record<string, boolean>>(submission.mentorChecks);
  const [note, setNote] = useState(submission.mentorNote ?? "");
  const pending = submission.status === "submitted";
  const results = useMemo(
    () => evaluateCriteria(studio, submission.work, submission.selfChecks, {}, "in-progress"),
    [studio, submission.work, submission.selfChecks],
  );
  const found = useMemo(() => foundHotspots(studio, submission.work), [studio, submission.work]);
  const hotspotCount = studio.canvas?.hotspots.length ?? 0;
  const mentorCriteria = studio.criteria.filter((c) => c.mode === "mentor");
  const allTicked = mentorCriteria.every((c) => checks[c.id]);
  const busy = fetcher.state !== "idle";
  const firstName = learner.name.split(" ")[0] || "the learner";

  const decide = (decision: "approved" | "changes-requested") =>
    fetcher.submit(
      { submissionId: submission.id, decision, note, mentorChecks: JSON.stringify(checks) },
      { method: "post" },
    );

  return (
    <div className="flex h-full min-h-0 flex-col xl:flex-row">
      <section aria-label="Submitted work" className="relative min-h-[480px] min-w-0 flex-1 overflow-hidden rounded-os-card bg-os-well">
        {studio.kind === "canvas" ? (
          <>
            <CanvasBoard mode="learner" readOnly items={submission.work.items ?? []} hotspots={studio.canvas?.hotspots} showHotspots foundHotspotIds={found} />
            {hotspotCount > 0 && (
              <p className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-os-card px-3 py-1.5 text-xs text-os-grey shadow-lg">
                Outlined areas are the hidden problems · {found.size} of {hotspotCount} found
              </p>
            )}
          </>
        ) : (
          <div className="absolute inset-0 overflow-y-auto">
            <div className="max-w-3xl px-6 py-10 lg:px-12">
              <DocEditor key={submission.id} editable={false} features={LESSON_FEATURES} initialContent={submission.work.doc ?? []} />
            </div>
          </div>
        )}
      </section>

      <aside aria-label="Review" className="flex shrink-0 flex-col xl:w-[400px]">
        <div className="os-form min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="flex items-center gap-3">
            <Avatar photoUrl={learner.photoUrl} name={learner.name} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{learner.name}</p>
              <p className="truncate text-xs text-os-muted">
                {submission.submittedAt ? `Submitted ${relativeTime(submission.submittedAt)}` : "Submitted"}
              </p>
            </div>
          </div>
          <h2 className="mt-5 font-heading text-lg font-semibold">{studio.title}</h2>
          <p className="mt-0.5 text-sm text-os-grey">
            {entry.moduleTitle} · {entry.journeyTitle}
          </p>

          <section className="mt-7" aria-labelledby="review-auto">
            <h3 id="review-auto" className="os-field-label">
              Automatic and self-checks
            </h3>
            <ul className="mt-3 space-y-3">
              {results
                .filter((r) => r.criterion.mode !== "mentor")
                .map(({ criterion, state, detail }) => (
                  <li key={criterion.id} className="flex items-start gap-3 text-sm">
                    <StateIcon passed={state === "pass"} />
                    <span className="min-w-0 flex-1 leading-5 text-foreground/85">
                      {criterion.label}
                      <span className="block text-xs text-os-muted">{criterion.mode === "self" ? "Ticked by the learner" : (detail ?? "Automatic")}</span>
                    </span>
                  </li>
                ))}
            </ul>
          </section>

          <section className="mt-7" aria-labelledby="review-mentor">
            <h3 id="review-mentor" className="os-field-label">
              Your review
            </h3>
            <ul className="mt-3 space-y-3">
              {mentorCriteria.map((c) => (
                <li key={c.id}>
                  <Checkbox
                    tone="os"
                    checked={Boolean(checks[c.id])}
                    disabled={!pending}
                    onChange={() => setChecks((s) => ({ ...s, [c.id]: !s[c.id] }))}
                    label={c.label}
                    description={c.description}
                  />
                </li>
              ))}
            </ul>
            <label className="mt-5 flex flex-col gap-1.5 text-sm text-os-grey">
              <span>Feedback for {firstName}</span>
              <textarea
                rows={5}
                value={note}
                disabled={!pending}
                placeholder="What's working, and what to change"
                onChange={(e) => setNote(e.target.value)}
                className="w-full resize-y leading-6"
              />
            </label>
            {fetcher.data && !fetcher.data.ok && <p className="mt-2 text-sm text-destructive">{fetcher.data.error}</p>}
          </section>
        </div>

        <div className="shrink-0 border-t border-os-container px-6 py-4">
          {pending ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={!note.trim() || busy}
                title={note.trim() ? undefined : "Say what to change in the feedback"}
                onClick={() => decide("changes-requested")}
                className={buttonClasses("ghost", "md")}
              >
                <X className="h-4 w-4" aria-hidden />
                Request changes
              </button>
              <button
                type="button"
                disabled={!allTicked || busy}
                title={allTicked ? undefined : "Tick every review item to approve"}
                onClick={() => decide("approved")}
                className={buttonClasses("primary", "md")}
              >
                <Check className="h-4 w-4" aria-hidden />
                Approve
              </button>
            </div>
          ) : (
            <p className={cn("text-sm", submission.status === "approved" ? "text-os-green" : "text-destructive")}>
              {submission.status === "approved" ? "Approved" : "Changes requested"}
              {submission.reviewerName && <span className="text-os-grey"> by {submission.reviewerName}</span>}
              {submission.reviewedAt && <span className="text-os-muted"> · {relativeTime(submission.reviewedAt)}</span>}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
