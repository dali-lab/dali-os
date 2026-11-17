import { DocEditor } from "~/components/doc";
import { buttonClasses } from "~/components/ui/Button";
import { Radio } from "~/components/ui/Radio";
import type { UrlCheckState } from "~/components/form-builder/QuestionField";
import { FormField } from "~/forms/components/FormField";
import { QuestionList } from "~/hiring/components/ApplicationAnswers";
import { formatShortDate, getDomainColor, getPickedQuestions, type DomainShape } from "~/hiring/lib/apply-sections";
import { visibleQuestions } from "~/forms/lib/form-logic";
import { isEmptyBlocks } from "~/lib/blocks";
import type { WordCountViolation } from "~/lib/word-count";
import type { Question } from "~/types";

export type DomainQuestionsCardProps = {
  domainId: string;
  domains: DomainShape[];
  hasChallenges: boolean;
  continuedFrom: Record<string, string>;
  continuedInterest: { description: any; questions: Question[] } | null;
  continuedAnswers: Record<string, Record<string, string>>;
  domainAnswers: Record<string, Record<string, string>>;
  pickedChallengeByDomain: Record<string, string>;
  closedDomainIds: Set<string>;
  urlChecks: Record<string, UrlCheckState>;
  urlWarnings: Record<string, string>;
  wordCountErrors: Record<string, WordCountViolation>;
  reusing: boolean;
  stopReusing: (domainId: string, domainName: string) => void;
  toggleDomain: (domainId: string) => void;
  handleChallengePick: (domainId: string, challengeVersionId: string) => void;
  setDomainAnswer: (domainId: string, key: string, value: string) => void;
  setContinuedAnswer: (domainId: string, key: string, value: string) => void;
  checkUrlField: (key: string, url: string, type: "github_url" | "figma_url" | "drive_url") => void;
};

export function DomainQuestionsCard({
  domainId,
  domains,
  hasChallenges,
  continuedFrom,
  continuedInterest,
  continuedAnswers,
  domainAnswers,
  pickedChallengeByDomain,
  closedDomainIds,
  urlChecks,
  urlWarnings,
  wordCountErrors,
  reusing,
  stopReusing,
  toggleDomain,
  handleChallengePick,
  setDomainAnswer,
  setContinuedAnswer,
  checkUrlField,
}: DomainQuestionsCardProps) {
  const domainIndex = domains.findIndex((d: DomainShape) => d.id === domainId);
  const domain = domains[domainIndex];
  const waitlistedCycle = continuedFrom[domainId];
  // No challenges, no per-domain questions: the domain pick is enough.
  if (!domain || (!hasChallenges && !waitlistedCycle)) return null;
  const color = getDomainColor(domainIndex);
  const pickedCvId = pickedChallengeByDomain[domainId] ?? null;
  const pickedQuestions = getPickedQuestions(domain, pickedCvId);
  const showPicker = domain.challenges.length > 1;

  // Reusing a waitlisted application: its answers read-only, then the
  // continued interest form.
  if (waitlistedCycle) {
    return (
      <div id={`section-domain-${domainId}`} className={`rounded-os-card ${color.cardBg} px-6 py-5 space-y-6 scroll-mt-24`}>
        <div className="flex items-center justify-between gap-3">
          <h3 className={`font-heading text-sm font-bold uppercase tracking-wider ${color.text}`}>
            {domain.name} Questions
          </h3>
          <button
            type="button"
            onClick={() => stopReusing(domainId, domain.name)}
            disabled={reusing}
            className={buttonClasses("secondary", "sm")}
          >
            Start a new application
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Your waitlisted application from {waitlistedCycle}. These answers can't be edited.
        </p>
        {pickedQuestions.length > 0 && (
          <QuestionList
            questions={pickedQuestions}
            answers={domainAnswers[domainId] ?? {}}
            presigned={false}
          />
        )}
        <div className="border-t border-border pt-6 space-y-6">
          <h4 className="font-heading text-sm font-bold text-foreground uppercase tracking-wider">
            Continued Interest
          </h4>
          {!isEmptyBlocks(continuedInterest?.description) && (
            <div className="text-foreground">
              <DocEditor
                features="notes"
                density="compact"
                editable={false}
                initialContent={continuedInterest!.description}
              />
            </div>
          )}
          {visibleQuestions(continuedInterest?.questions ?? [], continuedAnswers[domainId] ?? {}).map(q => (
            <FormField
              key={q.key}
              id={`question-${q.key}`}
              question={q}
              labelClassName="font-semibold"
              value={continuedAnswers[domainId]?.[q.key] ?? ""}
              onChange={v => setContinuedAnswer(domainId, q.key, v)}
              urlCheckState={urlChecks[q.key]}
              onUrlBlur={() => checkUrlField(q.key, continuedAnswers[domainId]?.[q.key] ?? "", q.type as "github_url" | "figma_url" | "drive_url")}
              belowField={
                <>
                  {urlWarnings[q.key] && (
                    <p className="text-xs text-os-amber mt-1">{urlWarnings[q.key]}</p>
                  )}
                  {wordCountErrors[q.key] && (
                    <p className="text-xs text-destructive mt-1">
                      Over the {wordCountErrors[q.key].maxWords}-word limit ({wordCountErrors[q.key].wordCount} words).
                    </p>
                  )}
                </>
              }
            />
          ))}
        </div>
      </div>
    );
  }

  const frozen = closedDomainIds.has(domainId);

  if (frozen) {
    return (
      <div id={`section-domain-${domainId}`} className={`rounded-os-card ${color.cardBg} px-6 py-5 space-y-6 scroll-mt-24`}>
        <h3 className={`font-heading text-sm font-bold uppercase tracking-wider ${color.text}`}>
          {domain.name} Questions
        </h3>
        <p className="text-xs text-muted-foreground">
          Closed {domain.closeDate ? formatShortDate(domain.closeDate) : ""}. This part is under
          review and can't be changed.
        </p>
        {pickedQuestions.length > 0 && (
          <QuestionList
            questions={pickedQuestions}
            answers={domainAnswers[domainId] ?? {}}
            presigned={false}
          />
        )}
      </div>
    );
  }

  return (
    <div id={`section-domain-${domainId}`} className={`rounded-os-card ${color.cardBg} px-6 py-5 space-y-6 scroll-mt-24`}>
      <div className="flex items-center justify-between">
        <h3 className={`font-heading text-sm font-bold uppercase tracking-wider ${color.text}`}>
          {domain.name} Questions
        </h3>
        <button
          onClick={() => toggleDomain(domainId)}
          aria-label={`Remove ${domain.name}`}
          className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {showPicker && (
        <div>
          <p className="text-xs font-semibold text-foreground mb-2">
            Choose your {domain.name} challenge <span className="os-required-mark">*</span>
          </p>
          <div className="space-y-2">
            {domain.challenges.map(c => (
              <Radio
                key={c.challengeVersionId}
                name={`challenge-${domainId}`}
                value={c.challengeVersionId}
                checked={pickedCvId === c.challengeVersionId}
                onChange={() => handleChallengePick(domainId, c.challengeVersionId)}
                label={<span className="text-foreground">{c.challengeName}</span>}
                className="text-sm"
              />
            ))}
          </div>
          {pickedCvId && (
            <p className="text-xs text-muted-foreground mt-2">
              Switching to a different challenge will clear your answers for this domain.
            </p>
          )}
        </div>
      )}

      {pickedCvId ? (
        <>
          {(() => {
            const pickedChallenge = domain.challenges.find(c => c.challengeVersionId === pickedCvId);
            return !isEmptyBlocks(pickedChallenge?.description) ? (
              <div className="text-foreground">
                {/* Keyed per picked challenge: DocEditor reads
                    initialContent once, so switching must remount. */}
                <DocEditor
                  key={pickedCvId}
                  features="notes"
                  density="compact"
                  editable={false}
                  initialContent={pickedChallenge!.description}
                />
              </div>
            ) : null;
          })()}
          {visibleQuestions(pickedQuestions, domainAnswers[domainId] ?? {}).map((q: Question) => (
            <FormField
              key={q.key}
              id={`question-${q.key}`}
              question={q}
              labelClassName="font-semibold"
              value={domainAnswers[domainId]?.[q.key] ?? ""}
              onChange={v => setDomainAnswer(domainId, q.key, v)}
              urlCheckState={urlChecks[q.key]}
              onUrlBlur={() => checkUrlField(q.key, domainAnswers[domainId]?.[q.key] ?? "", q.type as "github_url" | "figma_url" | "drive_url")}
              belowField={
                <>
                  {urlWarnings[q.key] && (
                    <p className="text-xs text-os-amber mt-1">{urlWarnings[q.key]}</p>
                  )}
                  {wordCountErrors[q.key] && (
                    <p className="text-xs text-destructive mt-1">
                      Over the {wordCountErrors[q.key].maxWords}-word limit ({wordCountErrors[q.key].wordCount} words).
                    </p>
                  )}
                </>
              }
            />
          ))}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Pick a challenge above to see this domain's questions.
        </p>
      )}
    </div>
  );
}
