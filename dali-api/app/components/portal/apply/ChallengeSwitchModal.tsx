import { Modal } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";

export type ChallengeSwitchModalProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ChallengeSwitchModal({ open, onCancel, onConfirm }: ChallengeSwitchModalProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      labelledBy="challenge-switch-title"
    >
      <h3 id="challenge-switch-title" className="font-heading text-base font-bold text-foreground mb-2">
        Switch challenge?
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        Switching to a different challenge will clear the answers you've already written
        for this domain, since each challenge has its own questions. This can't be undone.
      </p>
      <div className="flex gap-3 justify-end">
        <button
          onClick={onCancel}
          className={buttonClasses("secondary")}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={buttonClasses("primary")}
        >
          Switch and Clear Answers
        </button>
      </div>
    </Modal>
  );
}
