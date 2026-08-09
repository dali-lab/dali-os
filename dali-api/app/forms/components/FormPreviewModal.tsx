import { Eye, X } from "lucide-react";
import type { Question } from "~/types";
import { Modal } from "~/components/Modal";
import { FormFieldList } from "~/forms/components/FormField";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";
import { Button } from "~/components/ui/Button";

// Mirrors MemberFormShell + MemberFormFillView's chrome/layout exactly, so
// what's shown here matches /forms/fill/:token once published. Fields render
// via the same FormFieldList used by the real fill page, just disabled.
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

          <div className="mt-6 flex flex-col gap-5">
            {questions.length === 0 ? (
              <p className="text-sm text-muted-foreground/70 italic">
                No questions yet.
              </p>
            ) : (
              <FormFieldList questions={questions} disabled />
            )}

            <Button type="button" variant="primary" size="sm" disabled className="self-start">
              Submit
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
