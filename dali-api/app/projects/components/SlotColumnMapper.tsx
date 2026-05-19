// Shared "map this form's questions to columns" UI, shown on the Project
// Bids / Intent to Work boards beneath the form picker. The bound form stays
// fully flexible; here a staffing manager says which question fills each
// structured role for the slot, and renames the column label. The saved
// mapping is what interpretation + the display table key off.
//
// Slot-parameterised via SLOT_ROLES, so adding a slot later (applications) is
// a registry change, not a component change.
import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
import {
  SLOT_ROLES,
  type ColumnMapping,
  type ColumnMappingEntry,
  type QuestionTypeConstraint,
} from "~/projects/lib/slot-roles";
import type { Slot } from "~/projects/lib/form-slots";

type FormQuestion = {
  key: string;
  label: string;
  type: string;
  referenceSource?: string;
};

// A "row" in the mapper = one structured column the slot expects. Non-per-
// term roles are one row; per-term roles expand to one row per cycle term.
type RoleSlotRow = {
  role: string;
  defaultLabel: string;
  required: boolean;
  constraint: QuestionTypeConstraint;
  termId?: string;
  termLabel?: string;
};

export function SlotColumnMapper({
  slot,
  questions,
  mapping,
  cycleTerms,
  canManage,
}: {
  slot: Slot;
  questions: FormQuestion[];
  mapping: ColumnMapping | null;
  // Terms this cycle collects (only used by per-term roles, e.g. intent).
  cycleTerms: { id: string; code: string }[];
  canManage: boolean;
}) {
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const error =
    fetcher.data && typeof fetcher.data === "object" && "error" in fetcher.data
      ? String((fetcher.data as { error: unknown }).error)
      : null;

  const roleRows = useMemo<RoleSlotRow[]>(() => {
    const out: RoleSlotRow[] = [];
    for (const def of SLOT_ROLES[slot]) {
      if (def.perTerm) {
        for (const t of cycleTerms) {
          out.push({
            role: def.role,
            defaultLabel: `${def.defaultLabel} — ${t.code}`,
            required: def.required,
            constraint: def.constraint,
            termId: t.id,
            termLabel: t.code,
          });
        }
      } else {
        out.push({
          role: def.role,
          defaultLabel: def.defaultLabel,
          required: def.required,
          constraint: def.constraint,
        });
      }
    }
    return out;
  }, [slot, cycleTerms]);

  // Local editable state: per role-row, the chosen question key + label.
  const initial = useMemo(() => {
    const m: Record<string, { questionKey: string; label: string }> = {};
    for (const r of roleRows) {
      const k = rowKey(r);
      const found = mapping?.entries.find(
        (e) => e.role === r.role && (r.termId ? e.termId === r.termId : !e.termId),
      );
      m[k] = {
        // Person rows aren't question-sourced; questionKey stays "" and is
        // ignored by save() (a builtin entry is emitted instead).
        questionKey:
          found && found.source === "question" ? found.questionKey : "",
        label: found?.label ?? r.defaultLabel,
      };
    }
    return m;
  }, [roleRows, mapping]);

  const [draft, setDraft] = useState(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function update(key: string, patch: Partial<{ questionKey: string; label: string }>) {
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  }

  function save() {
    const entries: ColumnMappingEntry[] = [];
    for (const r of roleRows) {
      const v = draft[rowKey(r)];
      if (!v) continue;
      const common = {
        role: r.role,
        label: v.label.trim() || r.defaultLabel,
        ...(r.termId ? { termId: r.termId } : {}),
      };
      if (r.constraint === "person") {
        // Always-present, auto-sourced from the authenticated submitter; only
        // its label is user-editable.
        entries.push({ ...common, source: "builtin", builtin: "submitter" });
      } else {
        if (!v.questionKey) continue; // unmapped question row → omitted
        entries.push({
          ...common,
          source: "question",
          questionKey: v.questionKey,
        });
      }
    }
    const payload: ColumnMapping = { version: 1, entries };
    fetcher.submit(
      { intent: "set-slot-mapping", mapping: JSON.stringify(payload) },
      { method: "post" },
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">
          Column mapping
        </div>
        {!mapping && (
          <span className="text-[11px] text-amber-700">Not set up yet</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        Map the bound form&rsquo;s questions to the columns this view needs.
        Submissions aren&rsquo;t recorded until the required columns are mapped.
      </p>

      <div className="flex flex-col divide-y divide-border">
        {roleRows.map((r) => {
          const key = rowKey(r);
          const v = draft[key] ?? { questionKey: "", label: r.defaultLabel };
          return (
            <div
              key={key}
              className="py-2 flex flex-col sm:flex-row sm:items-center gap-2"
            >
              <div className="sm:w-40 shrink-0 text-sm text-foreground">
                {r.defaultLabel}
                {r.required && <span className="text-destructive"> *</span>}
              </div>
              {r.constraint === "person" ? (
                // Auto-sourced from the logged-in submitter — not a question.
                // Always present; only the column label is editable.
                <>
                  <div className="flex-1 text-sm text-muted-foreground italic">
                    Authenticated member (automatic)
                  </div>
                  {canManage ? (
                    <input
                      aria-label={`Column label for ${r.defaultLabel}`}
                      value={v.label}
                      disabled={saving}
                      onChange={(e) => update(key, { label: e.target.value })}
                      placeholder={r.defaultLabel}
                      className="sm:w-40 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                    />
                  ) : (
                    <div className="sm:w-40 text-sm text-foreground">
                      &ldquo;{v.label}&rdquo;
                    </div>
                  )}
                </>
              ) : canManage ? (
                <>
                  <select
                    aria-label={`Question for ${r.defaultLabel}`}
                    value={v.questionKey}
                    disabled={saving}
                    onChange={(e) => update(key, { questionKey: e.target.value })}
                    className="flex-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                  >
                    <option value="">— Not mapped —</option>
                    {questions.map((q) => (
                      <option key={q.key} value={q.key}>
                        {q.label} ({q.type})
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Column label for ${r.defaultLabel}`}
                    value={v.label}
                    disabled={saving}
                    onChange={(e) => update(key, { label: e.target.value })}
                    placeholder={r.defaultLabel}
                    className="sm:w-40 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                  />
                </>
              ) : (
                <div className="flex-1 text-sm text-muted-foreground">
                  {v.questionKey
                    ? `${questions.find((q) => q.key === v.questionKey)?.label ?? v.questionKey} → "${v.label}"`
                    : "Not mapped"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {canManage && (
        <div>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save mapping"}
          </button>
        </div>
      )}
    </div>
  );
}

function rowKey(r: RoleSlotRow): string {
  return r.termId ? `${r.role}:${r.termId}` : r.role;
}
