import { X } from "lucide-react";
import type { Question } from "~/types";
import { Modal } from "~/components/Modal";
import { ChallengePreview } from "~/components/ChallengePreview";

export interface ChallengePreviewModalProps {
  /** Stable id used for aria-labelledby. */
  challengeVersionId: string;
  challengeName: string;
  versionLabel?: string;
  description?: unknown;
  questions: Question[];
  onClose: () => void;
}

export function ChallengePreviewModal({
  challengeVersionId,
  challengeName,
  versionLabel,
  description,
  questions,
  onClose,
}: ChallengePreviewModalProps) {
  const headingId = `challenge-preview-heading-${challengeVersionId}`;
  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={headingId}
      containerClassName="bg-card rounded-2xl shadow-xl max-w-2xl w-full mx-4 p-6 max-h-[85vh] overflow-y-auto"
    >
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={headingId} className="text-lg font-bold text-foreground">
              {challengeName}
            </h2>
            {versionLabel && (
              <p className="text-xs text-muted-foreground mt-0.5">{versionLabel}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <ChallengePreview description={description} questions={questions} />
      </div>
    </Modal>
  );
}
