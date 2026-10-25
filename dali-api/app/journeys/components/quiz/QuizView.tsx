import { useRef, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, RotateCcw } from "lucide-react";
import type { Quiz } from "~/journeys/lib/types";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { useQuiz } from "./useQuiz";
import { QuizQuestionCard } from "./QuizQuestionCard";

export function QuizView({
  quiz,
  alreadyPassed,
  continueLabel,
  onPassed,
  onContinue,
}: {
  quiz: Quiz;
  alreadyPassed: boolean;
  continueLabel: string;
  onPassed: () => void;
  onContinue: () => void;
}) {
  const state = useQuiz(quiz);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { result } = state;
  const total = quiz.questions.length;

  const toTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!state.canSubmit) return;
    if (state.submit().passed) onPassed();
    toTop();
  };

  const handleRetry = () => {
    state.retry();
    toTop();
  };

  const action = result ? (
    result.passed ? (
      <button type="button" onClick={onContinue} className={buttonClasses("primary", "md")}>
        {continueLabel}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    ) : (
      <button type="button" onClick={handleRetry} className={buttonClasses("primary", "md")}>
        <RotateCcw className="h-4 w-4" aria-hidden />
        Try again
      </button>
    )
  ) : null;

  return (
    <div ref={scrollRef} className="h-full min-h-0 overflow-y-auto">
      <form onSubmit={handleSubmit} noValidate className="max-w-3xl px-6 py-10 lg:px-12">
        <p className="text-sm text-os-muted">
          Quiz · {total} {total === 1 ? "question" : "questions"} · Pass with {quiz.passingScore}%
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">{quiz.title}</h2>
        {quiz.intro && <p className="mt-3 max-w-2xl leading-7 text-os-grey">{quiz.intro}</p>}
        {alreadyPassed && !result && (
          <p className="mt-5 flex items-center gap-2 text-sm text-os-green">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            You've already passed this quiz. Retake it any time.
          </p>
        )}

        {result && (
          <div
            key={state.attempts}
            role="status"
            className={cn(
              "mt-8 flex flex-col gap-4 rounded-os-card p-5 sm:flex-row sm:items-center sm:justify-between",
              result.passed ? "bg-os-green/10" : "bg-destructive/10",
            )}
          >
            <div>
              <p className={cn("text-lg font-semibold", result.passed ? "text-os-green" : "text-destructive")}>
                {result.passed ? "Passed" : "Not passed yet"} · {result.correct} of {result.total} correct
              </p>
              <p className="mt-1 text-sm text-foreground/85">
                {result.passed
                  ? `You scored ${result.percent}%. Review the explanations below whenever you like.`
                  : `You scored ${result.percent}% and need ${quiz.passingScore}%. Your correct answers are kept, so just revisit the ones marked below.`}
              </p>
            </div>
            <div className="shrink-0">{action}</div>
          </div>
        )}

        {total === 0 ? (
          <p className="mt-10 text-os-grey">This quiz doesn't have any questions yet.</p>
        ) : (
          <ol className="mt-10 space-y-10">
            {quiz.questions.map((q, i) => (
              <QuizQuestionCard
                key={q.id}
                question={q}
                index={i}
                answer={state.answers[q.id] ?? ""}
                graded={result ? result.results[q.id] : null}
                reveal={Boolean(result?.passed)}
                onChange={(v) => state.setAnswer(q.id, v)}
              />
            ))}
          </ol>
        )}

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-os-container pt-6">
          {result ? (
            <>
              <p className="text-sm text-os-grey">
                <span className="tabular-nums text-foreground">{result.correct}</span> of {result.total} correct
              </p>
              {action}
            </>
          ) : (
            <>
              <p className="text-sm text-os-grey">
                <span className="tabular-nums text-foreground">{state.answered}</span> of {total} answered
              </p>
              <button type="submit" disabled={!state.canSubmit} className={buttonClasses("primary", "md")}>
                Check answers
              </button>
            </>
          )}
        </footer>
      </form>
    </div>
  );
}
