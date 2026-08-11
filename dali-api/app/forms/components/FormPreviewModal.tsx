import { useMemo, useState } from "react";
import { Eye, X } from "lucide-react";
import type { Question } from "~/types";
import { Modal } from "~/components/Modal";
import { FormQuestionField } from "~/components/form-builder/QuestionField";
import { FormFieldList } from "~/forms/components/FormField";
import {
  useFormPager,
  FormPagerNav,
  FormPageHeading,
} from "~/forms/components/FormPager";
import { paginateQuestions } from "~/lib/form-pages";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";
import { Button } from "~/components/ui/Button";

// Mirrors MemberFormFillView's rendering exactly (down to the file-upload
// notice) so what's shown here matches /forms/fill/:token once published.
// Fields are fully interactive — reference questions resolve to real option
// cards (see forms/preview-resolve) — but Submit doesn't hit the network;
// there's no versionId/token for an un-published draft to submit against.
export interface FormPreviewModalProps {
  formName: string;
  description?: unknown;
  questions: Question[];
  onClose: () => void;
}

export function FormPreviewModal({
  formName,
  description,
  questions,
  onClose,
}: FormPreviewModalProps) {
  const headingId = "form-preview-heading";
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const pages = useMemo(() => paginateQuestions(questions), [questions]);
  const pager = useFormPager(pages, { excludeFileType: true });

  function set(key: string, v: string) {
    setAnswers((a) => ({ ...a, [key]: v }));
  }

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={headingId}
      containerClassName="bg-section-bg rounded-2xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-dark-blue text-white px-5 py-3 rounded-t-2xl">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Eye className="w-4 h-4 flex-shrink-0" />
          Preview — this is what respondents will see once published
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="text-white/80 hover:text-white rounded p-1 hover:bg-white/10 flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 sm:p-8">
        <div className="mx-auto max-w-2xl bg-card border border-border shadow-brand-1 rounded-xl p-6 sm:p-8">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-7 h-7 bg-accent-coral rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-base leading-none font-heading">
                D
              </span>
            </div>
            <span className="font-heading text-sm font-bold text-dark-blue">
              DALI OS
            </span>
          </div>

          <h1 id={headingId} className="font-heading text-2xl font-bold text-dark-blue">
            {formName}
          </h1>
          {!isEmptyBlocks(description) && (
            <div className="mt-2 text-sm text-muted-foreground">
              <DocEditor
                features="notes"
                density="compact"
                editable={false}
                initialContent={description}
              />
            </div>
          )}

          {questions.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground/70 italic">
              No questions yet.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted(true);
              }}
              className="mt-6 flex flex-col gap-5"
            >
              <FormPageHeading page={pager.page} />
              <FormFieldList
                questions={pager.page.questions}
                values={answers}
                onChange={set}
                renderField={(q) =>
                  q.type === "file" ? (
                    <div className="text-xs text-muted-foreground italic border border-dashed border-border rounded-md px-3 py-2">
                      File uploads aren’t available here.
                    </div>
                  ) : (
                    <FormQuestionField
                      question={q}
                      value={answers[q.key] ?? ""}
                      onChange={(v) => set(q.key, v)}
                    />
                  )
                }
              />

              <FormPagerNav
                pager={pager}
                getValue={(q) => answers[q.key]}
                submitSlot={
                  <div className="flex items-center gap-3">
                    <Button type="submit" variant="primary" size="sm" className="self-start">
                      Submit
                    </Button>
                    {submitted && (
                      <span className="text-xs text-muted-foreground">
                        Preview only — nothing was submitted.
                      </span>
                    )}
                  </div>
                }
              />
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}
