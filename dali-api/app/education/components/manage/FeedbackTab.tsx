import { useSearchParams } from "react-router";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { Select } from "~/components/ui/floating";
import { formatDateTime } from "~/lib/display";

import type { ManageOfferingLoaderData } from "~/education/routes/education.manage.$offeringId";

export function FeedbackTab({ data }: { data: ManageOfferingLoaderData }) {
  const { exitFeedback, feedbackSessionId, offering, sessionFeedback, isCore: core } = data;
  const [, setSearchParams] = useSearchParams();
  const tz = useUserTimeZone();
  return (
        <div className="flex flex-col gap-5">
          <div className="os-form flex items-center gap-3">
            <span className="text-sm text-os-grey">Session</span>
            <Select
              value={feedbackSessionId ?? ""}
              onChange={(value) =>
                setSearchParams(
                  { tab: "feedback", session: value },
                  { preventScrollReset: true },
                )
              }
              options={offering.sessions.map((s) => ({
                value: s.id,
                label: `Session ${s.sequence}, ${formatDateTime(s.datetime, tz)}`,
              }))}
              buttonClassName="min-w-[16rem]"
            />
          </div>

          {!sessionFeedback ? (
            <p className="rounded-os-card bg-os-card px-6 py-5 text-sm italic text-os-grey">
              No session-feedback form is bound yet. Pick one on the Details tab.
            </p>
          ) : (
            <FeedbackResults
              title={`Session feedback (${sessionFeedback.submissions.length} response${sessionFeedback.submissions.length === 1 ? "" : "s"})`}
              anonymizedNote={!core}
              results={sessionFeedback}
            />
          )}

          {core && exitFeedback && (
            <FeedbackResults
              title={`Instructor exit surveys (${exitFeedback.submissions.length})`}
              anonymizedNote={false}
              results={exitFeedback}
            />
          )}
        </div>
  );
}

export function FeedbackResults({
  title,
  anonymizedNote,
  results,
}: {
  title: string;
  anonymizedNote: boolean;
  results: {
    responded: number;
    eligible: number;
    questions: { key: string; type: string; data: { label: string } }[];
    submissions: {
      id: string;
      answers: Record<string, unknown>;
      submitterName: string | null;
    }[];
  };
}) {
  const visibleQuestions = results.questions.filter((q) => q.type !== "info");
  const rate =
    results.eligible > 0
      ? Math.round((results.responded / results.eligible) * 100)
      : null;
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-[19px] font-semibold text-foreground">
          {title}
        </h2>
        {rate !== null && (
          <p className="mt-1 text-sm text-os-grey">
            {results.responded} of {results.eligible} responded ({rate}%)
          </p>
        )}
        {anonymizedNote && (
          <p className="mt-0.5 text-sm text-os-grey">
            Responses are anonymized and shown in a shuffled order.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-5 rounded-os-card bg-os-card p-5">
      {results.submissions.length === 0 ? (
        <p className="text-sm italic text-os-grey">No responses yet.</p>
      ) : anonymizedNote && results.responded < 3 ? (
        <p className="text-sm italic text-os-grey">
          Only {results.responded} response{results.responded === 1 ? "" : "s"} so far.
          Individual responses stay hidden until at least 3, to keep them anonymous.
        </p>
      ) : (
        visibleQuestions.map((q) => {
          // Aggregate answers: a tally for enumerable (choice/rating) questions
          // and an average when every answer is numeric. Skipped for free text
          // (too many distinct values).
          const values = results.submissions
            .map((s) => {
              const raw = s.answers[q.key];
              return raw == null || raw === ""
                ? null
                : Array.isArray(raw)
                  ? raw.join(", ")
                  : String(raw);
            })
            .filter((v): v is string => v !== null);
          const tally = new Map<string, number>();
          for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
          const nums = values.map(Number).filter((n) => Number.isFinite(n));
          const avg =
            values.length > 0 && nums.length === values.length
              ? nums.reduce((a, b) => a + b, 0) / nums.length
              : null;
          const showTally = tally.size > 0 && tally.size <= 8;
          return (
          <div key={q.key}>
            <h3 className="text-sm font-semibold text-foreground">{q.data.label}</h3>
            {(avg !== null || showTally) && (
              <p className="mt-1 text-sm text-os-grey">
                {avg !== null && (
                  <span className="font-semibold text-foreground">avg {avg.toFixed(1)}</span>
                )}
                {avg !== null && showTally && " · "}
                {showTally &&
                  [...tally.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([v, n]) => `${v} (${n})`)
                    .join(", ")}
              </p>
            )}
            <ul className="mt-2 flex flex-col gap-1.5">
              {results.submissions.map((s) => {
                const raw = s.answers[q.key];
                const value =
                  raw == null || raw === ""
                    ? null
                    : Array.isArray(raw)
                      ? raw.join(", ")
                      : String(raw);
                if (value === null) return null;
                return (
                  <li
                    key={s.id}
                    className="whitespace-pre-wrap rounded-os-item bg-os-well px-3.5 py-2.5 text-sm text-foreground"
                  >
                    {value}
                    {s.submitterName && (
                      <span className="text-os-grey"> · {s.submitterName}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          );
        })
      )}
      </div>
    </section>
  );
}
