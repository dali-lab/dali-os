import { isPrefillFieldKey, prefillFieldFits, prefillSummary } from "~/forms/lib/prefill-fields";
import { isReferenceSourceKey, REFERENCE_SOURCE_LABELS } from "~/forms/lib/reference-sources.shared";
import type { Question } from "~/types";

export function QuestionSourceNote({ question }: { question: Question }) {
  const source =
    question.type === "reference" && isReferenceSourceKey(question.data.referenceSource)
      ? `Choices from ${REFERENCE_SOURCE_LABELS[question.data.referenceSource]}`
      : null;
  const key = question.data.prefill;
  const prefill = isPrefillFieldKey(key) && prefillFieldFits(key, question) ? prefillSummary(key) : null;
  if (!source && !prefill) return null;
  return (
    <p className="text-sm text-muted-foreground mb-2">{[source, prefill].filter(Boolean).join(". ")}</p>
  );
}
