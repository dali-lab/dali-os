import { useMemo, useState } from "react";
import type { Question } from "~/types";
import { FormFieldList } from "~/forms/components/FormField";
import { FormPageHeading } from "~/forms/components/FormPager";
import { paginateQuestions } from "~/lib/form-pages";
import { Button } from "~/components/ui/Button";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";

export interface ChallengePreviewProps {
  description?: unknown;
  questions: Question[];
}

export function ChallengePreview({ description, questions }: ChallengePreviewProps) {
  const pages = useMemo(() => paginateQuestions(questions), [questions]);
  const [index, setIndex] = useState(0);
  const active = Math.min(index, pages.length - 1);
  const page = pages[active];
  const multi = pages.length > 1;

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
          <FormPageHeading page={page} />
          <FormFieldList
            questions={page.questions}
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
          {multi && (
            <div className="flex items-center gap-3 pt-2">
              {active > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                >
                  Back
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                Step {active + 1} of {pages.length}
              </span>
              {active < pages.length - 1 && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setIndex((i) => Math.min(pages.length - 1, i + 1))}
                >
                  Next
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
