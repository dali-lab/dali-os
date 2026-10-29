import { Eye, X } from "lucide-react";
import type { Question } from "~/types";
import { Modal } from "~/components/Modal";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { MemberFormCard, MemberFormFillView } from "~/forms/components/MemberFormFillView";
import { modalCardClass } from "~/components/os-chrome";

export interface FormPreviewModalProps {
  formId: string;
  formName: string;
  description?: unknown;
  questions: Question[];
  onClose: () => void;
}

export function FormPreviewModal({
  formId,
  formName,
  description,
  questions,
  onClose,
}: FormPreviewModalProps) {
  const headingId = "form-preview-heading";
  const tileSeed = useFeatureFlag("form-blocks") ? formId : null;

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={headingId}
      containerClassName={modalCardClass("max-w-2xl mx-4 max-h-[90vh]")}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-os-accent text-os-bg px-5 py-3 rounded-t-2xl">
        <div id={headingId} className="flex items-center gap-2 text-sm font-medium">
          <Eye className="w-4 h-4 flex-shrink-0" />
          Preview — this is what respondents will see once published
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="text-os-bg/80 hover:text-os-bg rounded p-1 hover:bg-os-bg/10 flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 sm:p-8">
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground/70 italic">No questions yet.</p>
        ) : (
          <MemberFormCard flush={Boolean(tileSeed)}>
            <MemberFormFillView
              preview
              tileSeed={tileSeed}
              data={{
                name: formName,
                description,
                questions,
                versionId: "",
                versionUpdatedAt: "",
                token: "",
              }}
            />
          </MemberFormCard>
        )}
      </div>
    </Modal>
  );
}
