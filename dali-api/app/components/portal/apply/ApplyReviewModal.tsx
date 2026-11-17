import { Modal } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { QuestionList } from "~/hiring/components/ApplicationAnswers";
import { getDomainColor, getPickedQuestions, visibleGeneralParts, type DomainShape } from "~/hiring/lib/apply-sections";
import { termCodeLabel } from "~/lib/display";
import type { Question } from "~/types";

type ContinuedInterest = { description: any; questions: Question[] } | null;

export type ApplyReviewModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  submitting: boolean;
  isAlreadySubmitted: boolean;
  startTermOptions: { id: string; code: string }[];
  startTermId: string | null;
  selectedDomainIds: string[];
  domains: DomainShape[];
  closedDomainIds: Set<string>;
  formQuestions: Question[];
  answers: Record<string, string>;
  domainAnswers: Record<string, Record<string, string>>;
  pickedChallengeByDomain: Record<string, string>;
  continuedFrom: Record<string, string>;
  continuedInterest: ContinuedInterest;
  continuedAnswers: Record<string, Record<string, string>>;
};

export function ApplyReviewModal({
  open,
  onClose,
  onConfirm,
  submitting,
  isAlreadySubmitted,
  startTermOptions,
  startTermId,
  selectedDomainIds,
  domains,
  closedDomainIds,
  formQuestions,
  answers,
  domainAnswers,
  pickedChallengeByDomain,
  continuedFrom,
  continuedInterest,
  continuedAnswers,
}: ApplyReviewModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="review-modal-title"
      disableEscape={submitting}
      containerClassName={modalCardClass("max-w-2xl")}
    >
      <h3 id="review-modal-title" className="font-heading text-base font-bold text-foreground mb-1">
        {isAlreadySubmitted ? "Review your changes" : "Review your application"}
      </h3>
      <p className="text-sm text-muted-foreground mb-5">
        Take one last look at your answers before {isAlreadySubmitted ? "updating" : "submitting"}. You can still go back to edit.
      </p>

      <div className="space-y-5">
        {/* Start term is a first-class field, not an answer, so it is not
            in any QuestionList below. validateForReview guarantees one is
            picked whenever the cycle offers a choice. */}
        {startTermOptions.length > 0 && (
          <div className="rounded-os-card bg-os-card px-5 py-4">
            <h4 className="font-heading text-xs font-bold text-foreground uppercase tracking-wider mb-1">
              Start term
            </h4>
            <p className="text-sm text-foreground">
              {(() => {
                const picked = startTermOptions.find(t => t.id === startTermId);
                return picked ? termCodeLabel(picked.code) : "Not selected";
              })()}
            </p>
          </div>
        )}

        {/* The per-domain cards below only appear for domains with
            questions, so list the picks themselves here. */}
        <div className="rounded-os-card bg-os-card px-5 py-4">
          <h4 className="font-heading text-xs font-bold text-foreground uppercase tracking-wider mb-1">
            Domains
          </h4>
          <p className="text-sm text-foreground">
            {selectedDomainIds
              .map(id => domains.find(d => d.id === id)?.name)
              .filter(Boolean)
              .join(", ") || "None selected"}
          </p>
          {(() => {
            const closedSelected = selectedDomainIds.filter(id => closedDomainIds.has(id));
            if (closedSelected.length === 0) return null;
            const openNames = selectedDomainIds
              .filter(id => !closedDomainIds.has(id))
              .map(id => domains.find(d => d.id === id)?.name)
              .filter(Boolean);
            const closedNames = closedSelected
              .map(id => domains.find(d => d.id === id)?.name)
              .filter(Boolean);
            return (
              <p className="text-xs text-muted-foreground mt-2">
                Submitting now: {openNames.join(", ") || "none"}. {closedNames.join(", ")}{" "}
                {closedNames.length === 1 ? "is" : "are"} closed and under review, not resubmitted.
              </p>
            );
          })()}
        </div>

        {(() => {
          const { before: beforeQuestions } = visibleGeneralParts(formQuestions as Question[], answers);
          return beforeQuestions.length > 0 ? (
            <div className="rounded-os-card bg-os-card px-5 py-4">
              <h4 className="font-heading text-xs font-bold text-foreground uppercase tracking-wider mb-4">
                General Questions
              </h4>
              {/* Apply page only has S3 keys, not presigned URLs — show filenames only */}
              <QuestionList questions={beforeQuestions} answers={answers} presigned={false} />
            </div>
          ) : null;
        })()}

        {selectedDomainIds.map(domainId => {
          const domainIndex = domains.findIndex((d: DomainShape) => d.id === domainId);
          const domain = domains[domainIndex];
          if (!domain) return null;
          const pickedCvId = pickedChallengeByDomain[domainId] ?? null;
          const pickedQuestions = getPickedQuestions(domain, pickedCvId);
          const continuedQuestions = continuedFrom[domainId] ? (continuedInterest?.questions ?? []) : [];
          if (pickedQuestions.length === 0 && continuedQuestions.length === 0) return null;
          const pickedName = domain.challenges.find(c => c.challengeVersionId === pickedCvId)?.challengeName;
          const color = getDomainColor(domainIndex);
          return (
            <div key={domainId} className={`rounded-os-card ${color.cardBg} px-5 py-4`}>
              <h4 className={`font-heading text-xs font-bold uppercase tracking-wider mb-1 ${color.text}`}>
                {domain.name}
              </h4>
              {pickedName && domain.challenges.length > 1 && (
                <p className="text-xs text-muted-foreground mb-3">Challenge: {pickedName}</p>
              )}
              {pickedQuestions.length > 0 && (
                <QuestionList
                  questions={pickedQuestions}
                  answers={domainAnswers[domainId] ?? {}}
                  presigned={false}
                />
              )}
              {continuedQuestions.length > 0 && (
                <div className={pickedQuestions.length > 0 ? "mt-5 border-t border-border pt-4" : undefined}>
                  <p className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">
                    Continued Interest
                  </p>
                  <QuestionList
                    questions={continuedQuestions}
                    answers={continuedAnswers[domainId] ?? {}}
                    presigned={false}
                  />
                </div>
              )}
            </div>
          );
        })}

        {(() => {
          const { after: afterQuestions } = visibleGeneralParts(formQuestions as Question[], answers);
          return afterQuestions.length > 0 ? (
            <div className="rounded-os-card bg-os-card px-5 py-4">
              <h4 className="font-heading text-xs font-bold text-foreground uppercase tracking-wider mb-4">
                Anything Else
              </h4>
              <QuestionList questions={afterQuestions} answers={answers} presigned={false} />
            </div>
          ) : null;
        })()}
      </div>

      <div className="flex gap-3 justify-end pt-5 mt-5 border-t border-border">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className={buttonClasses("secondary")}
        >
          Go Back and Edit
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className={buttonClasses("primary")}
        >
          {submitting ? "Submitting..." : "Confirm Submission"}
        </button>
      </div>
    </Modal>
  );
}
