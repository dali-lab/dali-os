import type { Question } from "~/types";
import { resolveReferenceOptions } from "./reference-sources";

// Stored answers → ordered label/value pairs for read-only display (the form
// responses viewer, partner application detail pages). Reference answers
// store ids; map them back to the source's current labels, falling back to
// the raw id when the option is gone.

export type FormAnswerRow = {
  key: string;
  label: string;
  value: string;
};

export async function formAnswerRows(
  questions: Question[],
  answers: Record<string, unknown>,
): Promise<FormAnswerRow[]> {
  const rows: FormAnswerRow[] = [];
  for (const q of questions) {
    if (q.type === "info") continue;
    const raw = answers[q.key];
    let value = "";
    if (raw != null && raw !== "") {
      if (q.type === "reference" && typeof raw === "string") {
        const options = await resolveReferenceOptions(q.data.referenceSource, {
          termId: q.data.referenceTermId,
        });
        value = options.find((o) => o.value === raw)?.label ?? raw;
      } else if (Array.isArray(raw)) {
        value = raw.map(String).join(", ");
      } else if (typeof raw === "object") {
        value = JSON.stringify(raw);
      } else {
        value = String(raw);
      }
    }
    rows.push({ key: q.key, label: q.data.label, value });
  }
  return rows;
}
