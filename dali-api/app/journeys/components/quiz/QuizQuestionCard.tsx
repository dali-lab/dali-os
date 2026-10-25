import { useId } from "react";
import { Check, X } from "lucide-react";
import type { QuizQuestion } from "~/journeys/lib/types";
import { isOpenResponse } from "~/journeys/lib/quiz";
import { cn } from "~/lib/cn";

export function QuizQuestionCard({
  question,
  index,
  answer,
  graded,
  reveal,
  onChange,
}: {
  question: QuizQuestion;
  index: number;
  answer: string;
  /** null until the quiz is checked. */
  graded: boolean | null;
  /** Show answers and explanations (once the quiz is passed). */
  reveal: boolean;
  onChange: (value: string) => void;
}) {
  const promptId = useId();
  const locked = graded !== null;
  const open = isOpenResponse(question);

  return (
    <li>
      <p id={promptId} className="flex gap-3 text-base font-medium leading-7 text-foreground">
        <span className="tabular-nums text-os-muted">{index + 1}.</span>
        <span>{question.prompt}</span>
      </p>

      <div className="mt-4 pl-7">
        {question.type === "multiple-choice" ? (
          <div role="radiogroup" aria-labelledby={promptId} className="space-y-2">
            {question.options.map((opt) => {
              const selected = answer === opt.id;
              const showCorrect = locked && opt.id === question.correctOptionId && (graded || reveal);
              const showWrong = locked && selected && !graded;
              return (
                <label
                  key={opt.id}
                  className={cn(
                    "flex items-center gap-3 rounded-os-item border px-4 py-3 text-sm transition-colors",
                    showCorrect
                      ? "border-os-green bg-os-green/10 text-foreground"
                      : showWrong
                        ? "border-destructive bg-destructive/10 text-foreground"
                        : selected
                          ? "border-os-accent/60 bg-os-container text-foreground"
                          : "border-os-container text-foreground/85",
                    locked ? "cursor-default" : "cursor-pointer hover:border-os-container-hi",
                  )}
                >
                  <span className="relative h-4 w-4 shrink-0">
                    <input
                      type="radio"
                      name={`q-${question.id}`}
                      value={opt.id}
                      checked={selected}
                      disabled={locked}
                      onChange={() => onChange(opt.id)}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full border border-os-container-hi transition-colors peer-checked:border-os-accent peer-focus-visible:ring-2 peer-focus-visible:ring-os-accent/40"
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 m-auto h-2 w-2 rounded-full bg-os-accent opacity-0 transition-opacity peer-checked:opacity-100"
                    />
                  </span>
                  <span className="flex-1">{opt.text}</span>
                  {showCorrect && <Check className="h-4 w-4 shrink-0 text-os-green" aria-label="Correct answer" />}
                  {showWrong && <X className="h-4 w-4 shrink-0 text-destructive" aria-label="Your answer, incorrect" />}
                </label>
              );
            })}
          </div>
        ) : (
          <div className="os-form">
            <textarea
              aria-labelledby={promptId}
              rows={3}
              value={answer}
              disabled={locked}
              placeholder={open ? "Write your response" : "Type your answer"}
              onChange={(e) => onChange(e.target.value)}
              className={cn(
                "w-full resize-y leading-6",
                locked && graded && "border-os-green",
                locked && !graded && "border-destructive",
              )}
            />
          </div>
        )}

        {locked && (
          <div className="mt-3 text-sm" aria-live="polite">
            <p className={cn("flex items-center gap-1.5 font-medium", graded ? "text-os-green" : "text-destructive")}>
              {graded ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
              {graded ? (open ? "Response recorded" : "Correct") : "Not quite"}
            </p>
            {!graded && reveal && question.type === "short-answer" && (
              <p className="mt-1 text-os-grey">
                Accepted answer: <span className="text-foreground">{question.acceptedAnswers.find((a) => a.trim())}</span>
              </p>
            )}
            {(graded || reveal) && question.explanation && (
              <p className="mt-1 leading-6 text-os-grey">{question.explanation}</p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
