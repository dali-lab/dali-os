import { Modal } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import type { DomainShape } from "~/hiring/lib/apply-sections";
import type { Question } from "~/types";

export type UrlWarningModalProps = {
  open: boolean;
  onFix: () => void;
  onSubmitAnyway: () => void;
  submitting: boolean;
  urlWarnings: Record<string, string>;
  formQuestions: Question[];
  domains: DomainShape[];
};

export function UrlWarningModal({ open, onFix, onSubmitAnyway, submitting, urlWarnings, formQuestions, domains }: UrlWarningModalProps) {
  return (
    <Modal
      open={open}
      onClose={onFix}
      labelledBy="url-warning-modal-title"
    >
      <h3 id="url-warning-modal-title" className="font-heading text-base font-bold text-foreground mb-2">Some links may be inaccessible</h3>
      <p className="text-sm text-muted-foreground mb-4">
        One or more URLs appear to be private or inaccessible. Reviewers may not be able to view them.
      </p>
      <ul className="space-y-2 mb-5">
        {Object.entries(urlWarnings).map(([key, message]) => {
          const allQuestions = [
            ...formQuestions,
            ...domains.flatMap((d: DomainShape) =>
              d.challenges.flatMap(c => c.questions),
            ),
          ];
          const q = allQuestions.find(q => q.key === key);
          return (
            <li key={key} className="text-sm text-os-amber bg-os-amber/15 rounded-lg px-3 py-2">
              <span className="font-semibold">{q?.data.label ?? key}:</span> {message}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-3 justify-end">
        <button
          onClick={onFix}
          className={buttonClasses("secondary")}
        >
          Go Back and Fix
        </button>
        <button
          onClick={onSubmitAnyway}
          disabled={submitting}
          className={buttonClasses("primary")}
        >
          Submit Anyway
        </button>
      </div>
    </Modal>
  );
}
