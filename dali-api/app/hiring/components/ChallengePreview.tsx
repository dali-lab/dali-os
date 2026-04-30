import type { Question } from "~/types";
import { ChallengeQuestionField } from "~/hiring/components/ChallengeQuestionField";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";

export interface ChallengePreviewProps {
  description?: unknown;
  questions: Question[];
}

const noop = () => {};

export function ChallengePreview({ description, questions }: ChallengePreviewProps) {
  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground italic">
        Preview — fields are disabled. Applicants will see this exactly.
      </p>

      {!isEmptyDoc(description) && (
        <div className="text-dark-blue px-4 py-3 rounded-lg border border-border bg-muted/30">
          <RichTextViewer content={description} />
        </div>
      )}

      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground/70 italic">No questions in this version.</p>
      ) : (
        <div className="space-y-6">
          {questions.map(q => (
            <div key={q.key}>
              <label className="block text-sm font-semibold text-dark-blue mb-1">
                {q.data.label}
                {q.required && <span className="text-accent-coral ml-0.5">*</span>}
                {q.data.afterDomains && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 align-middle">
                    Shown after domain questions
                  </span>
                )}
              </label>
              {q.data.description && (
                <p className="text-xs text-muted-foreground mb-1">{q.data.description}</p>
              )}
              <ChallengeQuestionField
                question={q}
                value=""
                onChange={noop}
                disabled
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
