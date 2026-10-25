import { useState } from "react";
import { CircleDot, PenLine, Settings } from "lucide-react";
import type { Quiz, QuizQuestion, QuizQuestionType } from "~/journeys/lib/types";
import { createQuestion, moveItem } from "~/journeys/lib/journey-edit";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { FormField } from "~/components/ui/FormField";
import { QuestionListItem } from "./QuestionListItem";
import { QuestionEditor } from "./QuestionEditor";

const SETTINGS = "settings";

export function QuizEditorWorkspace({ quiz, onChange }: { quiz: Quiz; onChange: (fn: (quiz: Quiz) => Quiz) => void }) {
  const [selected, setSelected] = useState<string>(quiz.questions[0]?.id ?? SETTINGS);
  const dialog = useDialog();
  const { fieldLabel } = useOsChrome();
  const index = quiz.questions.findIndex((q) => q.id === selected);
  const question = index >= 0 ? quiz.questions[index] : null;

  const setQuestions = (fn: (qs: QuizQuestion[]) => QuizQuestion[]) => onChange((q) => ({ ...q, questions: fn(q.questions) }));

  const addQuestion = (type: QuizQuestionType) => {
    const q = createQuestion(type);
    setQuestions((qs) => [...qs, q]);
    setSelected(q.id);
  };

  const deleteQuestion = async (id: string, number: number) => {
    const ok = await dialog.confirm({
      title: `Delete question ${number}?`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    const remaining = quiz.questions.filter((q) => q.id !== id);
    setQuestions((qs) => qs.filter((q) => q.id !== id));
    if (id === selected) setSelected(remaining[0]?.id ?? SETTINGS);
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside
        aria-label="Quiz outline"
        className="flex max-h-72 shrink-0 flex-col border-b border-os-container md:max-h-none md:w-80 md:border-b-0 md:border-r"
      >
        <div className="shrink-0 px-2 pt-3">
          <button
            type="button"
            onClick={() => setSelected(SETTINGS)}
            aria-current={selected === SETTINGS ? "true" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-os-item px-3 py-2.5 text-left text-sm transition-colors",
              selected === SETTINGS ? "bg-os-card text-foreground" : "text-foreground/85 hover:bg-os-hover",
            )}
          >
            <Settings className="h-4 w-4 shrink-0 text-os-muted" aria-hidden />
            Quiz settings
            <span className="ml-auto text-xs tabular-nums text-os-muted">Pass {quiz.passingScore}%</span>
          </button>
        </div>
        <h3 className="shrink-0 px-5 pb-2 pt-5 text-xs font-medium text-os-grey">
          Questions <span className="tabular-nums text-os-muted">{quiz.questions.length}</span>
        </h3>
        <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {quiz.questions.map((q, i) => (
            <QuestionListItem
              key={q.id}
              question={q}
              index={i}
              total={quiz.questions.length}
              active={q.id === selected}
              onSelect={() => setSelected(q.id)}
              onMove={(delta) => setQuestions((qs) => moveItem(qs, i, delta))}
              onDelete={() => void deleteQuestion(q.id, i + 1)}
            />
          ))}
          {quiz.questions.length === 0 && <li className="px-3 py-2 text-sm text-os-muted">No questions yet.</li>}
        </ol>
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-os-container p-3">
          <button type="button" onClick={() => addQuestion("multiple-choice")} className={buttonClasses("secondary", "sm", "px-2")}>
            <CircleDot className="h-3.5 w-3.5" aria-hidden />
            Multiple choice
          </button>
          <button type="button" onClick={() => addQuestion("short-answer")} className={buttonClasses("secondary", "sm", "px-2")}>
            <PenLine className="h-3.5 w-3.5" aria-hidden />
            Short answer
          </button>
        </div>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="os-form max-w-2xl px-6 pb-24 pt-10 lg:px-10">
          {question ? (
            <QuestionEditor
              key={question.id}
              question={question}
              index={index}
              onChange={(next) => setQuestions((qs) => qs.map((q) => (q.id === next.id ? next : q)))}
            />
          ) : (
            <div className="space-y-6">
              <h3 className="text-2xl font-semibold tracking-tight">Quiz settings</h3>
              <FormField label="Title" value={quiz.title} onChange={(title) => onChange((q) => ({ ...q, title }))} />
              <FormField
                label="Intro (optional)"
                multiline
                rows={3}
                value={quiz.intro}
                placeholder="What does this quiz check?"
                onChange={(intro) => onChange((q) => ({ ...q, intro }))}
              />
              <label className={fieldLabel}>
                <span>Passing score</span>
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={quiz.passingScore}
                    onChange={(e) => {
                      const value = Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0)));
                      onChange((q) => ({ ...q, passingScore: value }));
                    }}
                    className="w-24 tabular-nums"
                  />
                  <span className="text-sm text-os-grey">% of questions correct</span>
                </span>
                <span className="text-xs text-os-muted">
                  Learners must pass to finish the module. They can retry as often as they like, and correct answers carry over.
                </span>
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
