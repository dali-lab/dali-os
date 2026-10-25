import { Plus, X } from "lucide-react";
import type { QuizQuestion, QuizQuestionType } from "~/journeys/lib/types";
import { changeQuestionType, createId } from "~/journeys/lib/journey-edit";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Radio } from "~/components/ui/Radio";
import { Segmented } from "~/components/ui/Segmented";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { FormField } from "~/components/ui/FormField";

const TYPES: { value: QuizQuestionType; label: string }[] = [
  { value: "multiple-choice", label: "Multiple choice" },
  { value: "short-answer", label: "Short answer" },
];

export function QuestionEditor({
  question,
  index,
  onChange,
}: {
  question: QuizQuestion;
  index: number;
  onChange: (question: QuizQuestion) => void;
}) {
  const { sectionTitle } = useOsChrome();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-2xl font-semibold tracking-tight">Question {index + 1}</h3>
        <Segmented
          ariaLabel="Question type"
          size="md"
          value={question.type}
          options={TYPES}
          onChange={(type) => onChange(changeQuestionType(question, type))}
        />
      </div>

      <FormField
        label="Question"
        multiline
        rows={3}
        value={question.prompt}
        placeholder="What should the learner answer?"
        onChange={(prompt) => onChange({ ...question, prompt })}
      />

      {question.type === "multiple-choice" ? (
        <section>
          <h4 className={cn(sectionTitle, "text-base")}>Answer options</h4>
          <p className="mt-1 text-xs text-os-muted">Pick the correct answer.</p>
          <ul className="mt-3 space-y-2">
            {question.options.map((opt, i) => {
              const correct = question.correctOptionId === opt.id;
              return (
                <li key={opt.id} className="flex items-center gap-3">
                  <Radio
                    name={`correct-${question.id}`}
                    checked={correct}
                    onChange={() => onChange({ ...question, correctOptionId: opt.id })}
                    aria-label={`Mark option ${i + 1} correct`}
                  />
                  <input
                    type="text"
                    value={opt.text}
                    placeholder={`Option ${i + 1}`}
                    aria-label={`Option ${i + 1}`}
                    onChange={(e) =>
                      onChange({
                        ...question,
                        options: question.options.map((o) => (o.id === opt.id ? { ...o, text: e.target.value } : o)),
                      })
                    }
                    className={cn("min-w-0 flex-1", correct && "border-os-accent/60")}
                  />
                  <span className={cn("w-14 shrink-0 text-xs", correct ? "text-os-accent" : "invisible")} aria-hidden={!correct}>
                    Correct
                  </span>
                  <IconButton
                    label={`Remove option ${i + 1}`}
                    icon={X}
                    tone="destructive"
                    disabled={question.options.length <= 2}
                    onClick={() => {
                      const options = question.options.filter((o) => o.id !== opt.id);
                      onChange({ ...question, options, correctOptionId: correct ? options[0].id : question.correctOptionId });
                    }}
                  />
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => onChange({ ...question, options: [...question.options, { id: createId("opt"), text: "" }] })}
            className={buttonClasses("ghost", "sm", "mt-3")}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add option
          </button>
        </section>
      ) : (
        <section>
          <h4 className={cn(sectionTitle, "text-base")}>Accepted answers</h4>
          <p className="mt-1 text-xs leading-5 text-os-muted">
            Case, extra spaces and trailing punctuation are ignored. Leave every field empty to accept any response.
          </p>
          <ul className="mt-3 space-y-2">
            {question.acceptedAnswers.map((answer, i) => (
              <li key={i} className="flex items-center gap-3">
                <input
                  type="text"
                  value={answer}
                  placeholder={i === 0 ? "e.g. flexbox" : "Another accepted answer"}
                  aria-label={`Accepted answer ${i + 1}`}
                  onChange={(e) =>
                    onChange({
                      ...question,
                      acceptedAnswers: question.acceptedAnswers.map((a, j) => (j === i ? e.target.value : a)),
                    })
                  }
                  className="min-w-0 flex-1"
                />
                <IconButton
                  label={`Remove accepted answer ${i + 1}`}
                  icon={X}
                  tone="destructive"
                  disabled={question.acceptedAnswers.length <= 1}
                  onClick={() => onChange({ ...question, acceptedAnswers: question.acceptedAnswers.filter((_, j) => j !== i) })}
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => onChange({ ...question, acceptedAnswers: [...question.acceptedAnswers, ""] })}
            className={buttonClasses("ghost", "sm", "mt-3")}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add accepted answer
          </button>
        </section>
      )}

      <FormField
        label="Explanation (optional)"
        multiline
        rows={3}
        value={question.explanation ?? ""}
        placeholder="Why is this the right answer?"
        hint="Shown after a correct answer, or once the learner passes."
        onChange={(explanation) => onChange({ ...question, explanation: explanation || undefined })}
      />
    </div>
  );
}
