import { useState } from "react";
import { useSubmit, useActionData, useNavigation } from "react-router";
import { FormQuestionField } from "~/components/form-builder/QuestionField";
import { FormFieldList } from "~/forms/components/FormField";
import { DocEditor, countWords } from "~/components/doc";
import { Button } from "~/components/ui/Button";
import { findMissingRequired } from "~/lib/form-answers";
import type { Question } from "~/types";

// Education apply/RSVP form. Modeled on MemberFormFillView, but posts the
// answers JSON to the surrounding route's action (member and portal apply
// routes share this component with different actions) instead of the public
// forms fill endpoint.

export function OfferingApplyForm({
  questions,
  description,
  defaultAnswers,
  submitLabel,
}: {
  questions: Question[];
  description: unknown;
  defaultAnswers?: Record<string, string>;
  submitLabel: string;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    defaultAnswers ?? {},
  );
  const [clientError, setClientError] = useState<string | null>(null);
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const submit = useSubmit();

  function set(key: string, v: string) {
    setAnswers((a) => ({ ...a, [key]: v }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setClientError(null);
    const missing = findMissingRequired(questions, (q) => answers[q.key], {
      excludeFileType: true,
    });
    if (missing.length > 0) {
      setClientError(`"${missing[0].data.label}" is required.`);
      return;
    }
    const fd = new FormData();
    fd.set("answers", JSON.stringify(answers));
    submit(fd, { method: "post" });
  }

  const error = clientError ?? actionData?.error;

  return (
    <div>
      {/* description is block JSON (loaders normalize via ensureBlocks);
          countWords(non-array) is 0, so stray legacy shapes just hide it. */}
      {countWords(description) > 0 && (
        <div className="text-sm text-muted-foreground">
          <DocEditor features="notes" editable={false} initialContent={description} />
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-5">
        <FormFieldList
          questions={questions}
          values={answers}
          onChange={set}
          renderField={(q) =>
            q.type === "file" ? (
              <div className="text-xs text-muted-foreground italic border border-dashed border-border rounded-md px-3 py-2">
                File uploads aren&apos;t available on applications.
              </div>
            ) : (
              <FormQuestionField
                question={q}
                value={answers[q.key] ?? ""}
                onChange={(v) => set(q.key, v)}
              />
            )
          }
        />
        <Button
          type="submit"
          size="sm"
          disabled={navigation.state !== "idle"}
          className="self-start"
        >
          {navigation.state !== "idle" ? "Submitting…" : submitLabel}
        </Button>
      </form>
    </div>
  );
}
