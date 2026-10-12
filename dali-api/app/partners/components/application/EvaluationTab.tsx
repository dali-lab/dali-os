// Discovery evaluation rubric, lifted out of core.partners.applications.$id.tsx
// (was EvaluationCard) so PartnerApplicationModal can show the same card.
// Controlled + fetch-saved (not an uncontrolled <Form>) so it works mounted
// under the board route too — see partner-detail-fetch.ts.

import { useState } from "react";
import { Button } from "~/components/ui/Button";
import {
  EVAL_CRITERIA,
  EVAL_CRITERIA_VERSION,
  FIRST_MEETING_PROMPTS,
  parseEvalRubric,
  type EvalCriterionKey,
} from "../../lib/discovery-rubric";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";

export function EvaluationTab({
  applicationId,
  evalRubric,
  interviewRating,
  canEdit,
  onChanged,
}: {
  applicationId: string;
  evalRubric: unknown;
  interviewRating: number | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const rubric = parseEvalRubric(evalRubric);
  const [scores, setScores] = useState<Partial<Record<EvalCriterionKey, number>>>(rubric);
  const [rating, setRating] = useState<number | null>(interviewRating);
  const [notes, setNotes] = useState(rubric.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const fields: Record<string, string> = {
      evalNotes: notes.trim(),
      criteriaVersion: String(EVAL_CRITERIA_VERSION),
    };
    for (const c of EVAL_CRITERIA) {
      if (scores[c.key] != null) fields[`score_${c.key}`] = String(scores[c.key]);
    }
    if (rating != null) fields.interviewRating = String(rating);
    const res = await postPartnerApplicationIntent(applicationId, "eval", fields);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't save the evaluation.");
      return;
    }
    onChanged();
  }

  return (
    <section>
      <p className="mb-3 text-xs text-muted-foreground">
        Score each criterion 1 (low) – 5 (high) after the discovery meeting.
      </p>

      <div className="mb-4 rounded-md bg-muted/30 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Discovery meeting prompts</p>
        <ol className="list-inside list-decimal space-y-1">
          {FIRST_MEETING_PROMPTS.map((p, i) => (
            <li key={i} className="text-xs text-muted-foreground">
              {p}
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-3">
        {EVAL_CRITERIA.map((c) => (
          <div key={c.key} className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">{c.label}</p>
              <p className="text-xs text-muted-foreground">{c.description}</p>
            </div>
            <ScorePicker
              name={`eval-${c.key}`}
              value={scores[c.key] ?? null}
              disabled={!canEdit}
              onChange={(n) => setScores((s) => ({ ...s, [c.key]: n }))}
            />
          </div>
        ))}

        <div className="flex items-center gap-3 border-t border-border pt-2">
          <span className="flex-1 text-xs font-medium text-foreground">
            Overall interview rating (1–5)
          </span>
          <ScorePicker name="eval-interview-rating" value={rating} disabled={!canEdit} onChange={setRating} />
        </div>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Eval notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            disabled={!canEdit}
            placeholder="Notes for the team…"
            className="resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </label>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {canEdit && (
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save evaluation"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function ScorePicker({
  name,
  value,
  disabled,
  onChange,
}: {
  name: string;
  value: number | null;
  disabled?: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className="cursor-pointer">
          <input
            type="radio"
            name={name}
            value={n}
            disabled={disabled}
            checked={value === n}
            onChange={() => onChange(n)}
            className="peer sr-only"
          />
          <span className="flex h-7 w-7 items-center justify-center rounded border border-border text-xs font-medium text-muted-foreground transition-colors peer-checked:border-accent-coral peer-checked:bg-accent-coral peer-checked:text-white hover:bg-muted">
            {n}
          </span>
        </label>
      ))}
    </div>
  );
}
