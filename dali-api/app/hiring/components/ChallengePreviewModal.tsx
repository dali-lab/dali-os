import type { Question } from "~/types";
import { Modal, ModalHeader } from "~/components/Modal";
import { ChallengePreview } from "~/hiring/components/ChallengePreview";

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
        <ModalHeader
          titleId={headingId}
          title={challengeName}
          subtitle={versionLabel}
          onClose={onClose}
          closeLabel="Close preview"
          className="mb-0"
        />
        <ChallengePreview description={description} questions={questions} />
      </div>
    </Modal>
  );
}
