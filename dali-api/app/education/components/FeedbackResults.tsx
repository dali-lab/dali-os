// Aggregates feedback submissions, shows tally + avg for numeric questions,
// anonymizes under 3 responses for non-Core.
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
    <section className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {rate !== null && (
          <p className="text-xs font-medium text-muted-foreground mt-0.5">
            {results.responded} of {results.eligible} responded ({rate}%)
          </p>
        )}
        {anonymizedNote && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Responses are anonymized and shown in a shuffled order.
          </p>
        )}
      </div>
      {results.submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No responses yet.</p>
      ) : anonymizedNote && results.responded < 3 ? (
        <p className="text-sm text-muted-foreground italic">
          Only {results.responded} response{results.responded === 1 ? "" : "s"} so far —
          individual responses stay hidden until at least 3, to keep them anonymous.
        </p>
      ) : (
        visibleQuestions.map((q) => {
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
            <h3 className="text-xs font-semibold text-muted-foreground">
              {q.data.label}
            </h3>
            {(avg !== null || showTally) && (
              <p className="mt-0.5 text-xs text-muted-foreground">
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
            <ul className="mt-1 flex flex-col gap-1">
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
                    className="text-sm text-foreground border-l-2 border-border pl-3 whitespace-pre-wrap"
                  >
                    {value}
                    {s.submitterName && (
                      <span className="text-xs text-muted-foreground"> — {s.submitterName}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          );
        })
      )}
    </section>
  );
}
