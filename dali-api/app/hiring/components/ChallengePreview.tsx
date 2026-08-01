import type { Question } from "~/types";
import { FormFieldList } from "~/forms/components/FormField";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";

export interface ChallengePreviewProps {
  description?: unknown;
  questions: Question[];
}

export function ChallengePreview({ description, questions }: ChallengePreviewProps) {
  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground italic">
        Preview — fields are disabled. Applicants will see this exactly.
      </p>

      {!isEmptyBlocks(description) && (
        <div className="text-dark-blue px-4 py-3 rounded-lg border border-border bg-muted/30">
          <DocEditor
            features="notes"
            density="compact"
            editable={false}
            initialContent={description}
          />
        </div>
      )}

      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground/70 italic">No questions in this version.</p>
      ) : (
        <div className="space-y-6">
          <FormFieldList
            questions={questions}
            disabled
            labelClassName="font-semibold"
            labelSuffix={q =>
              q.data.afterDomains ? (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 align-middle">
                  Shown after domain questions
                </span>
              ) : null
            }
          />
        </div>
      )}
    </div>
  );
}
