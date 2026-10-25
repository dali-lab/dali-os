import { useState } from "react";
import { CircleDot, Eye, ListChecks, Maximize2, PenLine, Plus, Trash2 } from "lucide-react";
import type { JourneyModule, Quiz } from "~/journeys/lib/types";
import { createQuiz } from "~/journeys/lib/journey-edit";
import { moduleTitle } from "~/journeys/lib/journey";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { FullscreenEditor } from "./FullscreenEditor";
import { QuizEditorWorkspace } from "./quiz/QuizEditorWorkspace";
import { QuizView } from "../quiz/QuizView";

const PREVIEW_COUNT = 6;

export function QuizTab({
  module: mod,
  onChange,
}: {
  module: JourneyModule;
  onChange: (fn: (m: JourneyModule) => JourneyModule) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const dialog = useDialog();
  const quiz = mod.quiz;
  const name = moduleTitle(mod);

  if (!quiz) {
    return (
      <div className="py-8 text-center">
        <ListChecks className="mx-auto h-8 w-8 text-os-muted" aria-hidden />
        <h4 className="mt-3 font-medium">No quiz in this module</h4>
        <p className="mx-auto mt-1 max-w-xs text-sm text-os-grey">
          Add a short quiz. Learners need to pass it to finish the module.
        </p>
        <button
          type="button"
          onClick={() => {
            onChange((m) => ({ ...m, quiz: createQuiz() }));
            setEditing(true);
          }}
          className={buttonClasses("primary", "md", "mt-5")}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add quiz
        </button>
      </div>
    );
  }

  const updateQuiz = (fn: (q: Quiz) => Quiz) => onChange((m) => (m.quiz ? { ...m, quiz: fn(m.quiz) } : m));
  const mcCount = quiz.questions.filter((q) => q.type === "multiple-choice").length;
  const saCount = quiz.questions.length - mcCount;

  const removeQuiz = async () => {
    const ok = await dialog.confirm({
      title: "Remove this quiz?",
      description: "Its questions are deleted from the draft.",
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (ok) onChange((m) => ({ ...m, quiz: undefined }));
  };

  const tryButton = (size: "sm" | "md", extra?: string) => (
    <button
      type="button"
      onClick={() => setPreviewing(true)}
      disabled={quiz.questions.length === 0}
      className={buttonClasses(size === "sm" ? "primary" : "secondary", size, extra)}
    >
      <Eye className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
      Try as a learner
    </button>
  );

  return (
    <div className="space-y-5">
      <div>
        <h4 className="font-semibold">{quiz.title || "Untitled quiz"}</h4>
        {quiz.intro && <p className="mt-1 line-clamp-3 text-sm leading-6 text-os-grey">{quiz.intro}</p>}
        <p className="mt-2 text-xs text-os-muted">
          {mcCount} multiple choice · {saCount} short answer · pass with {quiz.passingScore}%
        </p>
      </div>

      <div className="grid gap-2">
        <button type="button" onClick={() => setEditing(true)} className={buttonClasses("primary", "md", "w-full")}>
          <Maximize2 className="h-4 w-4" aria-hidden />
          Open quiz editor
        </button>
        {tryButton("md", "w-full")}
      </div>

      {quiz.questions.length > 0 && (
        <section>
          <h4 className="text-xs font-medium text-os-grey">Questions</h4>
          <ol className="mt-2 space-y-2">
            {quiz.questions.slice(0, PREVIEW_COUNT).map((q, i) => {
              const Icon = q.type === "multiple-choice" ? CircleDot : PenLine;
              return (
                <li key={q.id} className="flex items-start gap-3 text-sm">
                  <span className="w-4 shrink-0 tabular-nums text-os-muted">{i + 1}</span>
                  <span className={q.prompt.trim() ? "min-w-0 flex-1 truncate text-foreground/85" : "min-w-0 flex-1 truncate text-os-muted"}>
                    {q.prompt.trim() || "Untitled question"}
                  </span>
                  <Icon
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-os-muted"
                    aria-label={q.type === "multiple-choice" ? "Multiple choice" : "Short answer"}
                  />
                </li>
              );
            })}
          </ol>
          {quiz.questions.length > PREVIEW_COUNT && (
            <p className="mt-1 pl-7 text-xs text-os-muted">+{quiz.questions.length - PREVIEW_COUNT} more</p>
          )}
        </section>
      )}

      <section className="border-t border-os-container pt-5">
        <button type="button" onClick={() => void removeQuiz()} className={buttonClasses("ghost", "sm", "hover:text-destructive")}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Remove quiz
        </button>
      </section>

      <FullscreenEditor
        open={editing}
        title={`${name} · Quiz`}
        subtitle="Changes save to your draft as you type"
        onClose={() => setEditing(false)}
        actions={tryButton("sm")}
      >
        <QuizEditorWorkspace quiz={quiz} onChange={updateQuiz} />
      </FullscreenEditor>

      <FullscreenEditor
        open={previewing}
        title={`Testing: ${quiz.title || "Untitled quiz"}`}
        subtitle="This is what learners see. Answers here aren't saved."
        onClose={() => setPreviewing(false)}
      >
        <QuizView
          quiz={quiz}
          alreadyPassed={false}
          continueLabel="Close preview"
          onPassed={() => undefined}
          onContinue={() => setPreviewing(false)}
        />
      </FullscreenEditor>
    </div>
  );
}
