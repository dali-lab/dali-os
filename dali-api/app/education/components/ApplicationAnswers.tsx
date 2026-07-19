import type { Question } from "~/types";

// Read-only answer rendering for the manage review tab. Answers are shown
// against the questions of the FormVersion the submission was made on, so a
// form edited mid-window still displays each submission correctly.

export function ApplicationAnswers({
  questions,
  answers,
}: {
  questions: Question[];
  answers: Record<string, unknown>;
}) {
  const visible = questions.filter((q) => q.type !== "info");
  if (visible.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">No questions on this form.</p>
    );
  }
  return (
    <dl className="flex flex-col gap-3">
      {visible.map((q) => {
        const raw = answers[q.key];
        const value =
          raw == null || raw === ""
            ? null
            : Array.isArray(raw)
              ? raw.join(", ")
              : typeof raw === "object"
                ? JSON.stringify(raw)
                : String(raw);
        return (
          <div key={q.key}>
            <dt className="text-xs font-semibold text-muted-foreground">
              {q.data.label}
            </dt>
            <dd className="text-sm text-foreground whitespace-pre-wrap mt-0.5">
              {value ?? <span className="italic text-muted-foreground">No answer</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
