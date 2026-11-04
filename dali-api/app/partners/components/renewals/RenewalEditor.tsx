// The renewal decision fields, appended inside an expanded board card —
// deciding happens on the card itself, not in a modal.

import { useState } from "react";
import { Link } from "react-router";
import { Minus, Plus } from "lucide-react";
import { Select } from "~/components/ui/floating";
import { DateField } from "~/components/ui/DateField";
import { useOsChrome } from "~/components/os-chrome";
import {
  addDomainRole,
  centsToDollars,
  dollarsToCents,
  dueToInput,
  stepSlots,
  type RenewalCardModel,
  type RenewalColumn,
  type RenewalRole,
} from "../../lib/partner-renewals";

export type TermOption = { id: string; code: string };
export type DomainOption = { id: string; name: string };

export type RenewalSubmission = {
  intent: "continue" | "not-continuing" | "undecided";
  projectId: string;
  nextStep: string;
  nextStepDue: string;
  termId?: string;
  feeCents?: number | null;
  roles?: RenewalRole[];
  reason?: string;
};

const INTENT: Record<RenewalColumn, RenewalSubmission["intent"]> = {
  undecided: "undecided",
  continuing: "continue",
  not_continuing: "not-continuing",
};

export function toFormFields(v: RenewalSubmission): Record<string, string> {
  const fields: Record<string, string> = {
    intent: v.intent,
    projectId: v.projectId,
    nextStep: v.nextStep,
    nextStepDue: v.nextStepDue,
  };
  if (v.intent === "continue") {
    fields.termId = v.termId ?? "";
    fields.feeCents = v.feeCents == null ? "" : String(v.feeCents);
    fields.roles = JSON.stringify((v.roles ?? []).map((r) => ({ domainId: r.domainId, slots: r.slots })));
  }
  if (v.intent === "not-continuing") fields.reason = v.reason ?? "";
  return fields;
}

const inputClass =
  "w-full rounded-os-item border border-os-border bg-os-card px-2.5 py-1.5 text-sm text-foreground";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

export function RenewalEditorFields({
  card,
  decision,
  decisionTerm,
  termOptions,
  domains,
  busy,
  onCancel,
  onSave,
}: {
  card: RenewalCardModel;
  decision: RenewalColumn;
  decisionTerm: TermOption;
  termOptions: TermOption[];
  domains: DomainOption[];
  busy: boolean;
  onCancel: () => void;
  onSave: (v: RenewalSubmission) => void;
}) {
  const { formClass } = useOsChrome();
  const [termId, setTermId] = useState(
    termOptions.find((t) => t.code === card.fromTermCode)?.id ?? decisionTerm.id,
  );
  const [roles, setRoles] = useState<RenewalRole[]>(
    card.column === "continuing" && card.decidedRoles.length ? card.decidedRoles : card.lastRoles,
  );
  const [fee, setFee] = useState(centsToDollars(card.feeCents));
  const [reason, setReason] = useState(card.reason ?? "");
  const [nextStep, setNextStep] = useState(card.nextStep ?? "");
  const [due, setDue] = useState(dueToInput(card.nextStepDueAt));
  const addable = domains.filter((d) => !roles.some((r) => r.domainId === d.id));
  const canSave = !busy && (decision !== "not_continuing" || reason.trim().length > 0);

  return (
    <div
      className={`${formClass} flex flex-col gap-3 text-left`}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      {decision === "continuing" && (
        <>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Term</FieldLabel>
            <Select
              ariaLabel="Term"
              value={termId}
              onChange={setTermId}
              options={termOptions.map((t) => ({ value: t.id, label: t.code }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Spots per domain</FieldLabel>
            {roles.map((r) => (
              <div key={r.domainId} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{r.name}</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Fewer ${r.name}`}
                    className="os-icon-btn"
                    onClick={() => setRoles((cur) => stepSlots(cur, r.domainId, -1))}
                  >
                    <Minus className="h-4 w-4" aria-hidden />
                  </button>
                  <span className="w-6 text-center tabular-nums">{r.slots}</span>
                  <button
                    type="button"
                    aria-label={`More ${r.name}`}
                    className="os-icon-btn"
                    onClick={() => setRoles((cur) => stepSlots(cur, r.domainId, 1))}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                  </button>
                </span>
              </div>
            ))}
            {addable.length > 0 && (
              <Select
                ariaLabel="Add domain"
                placeholder="+ Domain"
                value={undefined}
                onChange={(id) => {
                  const d = domains.find((x) => x.id === id);
                  if (d) setRoles((cur) => addDomainRole(cur, d.id, d.name));
                }}
                options={addable.map((d) => ({ value: d.id, label: d.name }))}
              />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Fee</FieldLabel>
            <input
              aria-label="Fee"
              className={inputClass}
              inputMode="decimal"
              placeholder="Dollars"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </div>
        </>
      )}

      {decision === "not_continuing" && (
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Reason</FieldLabel>
          <input
            aria-label="Reason"
            autoFocus
            className={inputClass}
            placeholder="Why is this project not continuing?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <FieldLabel>Next step</FieldLabel>
        <input
          aria-label="Next step"
          className={inputClass}
          placeholder="What happens next?"
          value={nextStep}
          onChange={(e) => setNextStep(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Due</FieldLabel>
        <DateField mode="date" ariaLabel="Next step due" value={due} onChange={setDue} />
      </div>

      <div className="flex items-center gap-1.5 pt-0.5">
        <Link
          to={`/projects/${card.projectId}`}
          className="text-xs text-os-accent hover:underline"
        >
          Open project
        </Link>
        <span className="flex-1" />
        <button type="button" className="os-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSave}
          className="os-btn-primary disabled:opacity-60"
          onClick={() =>
            onSave({
              intent: INTENT[decision],
              projectId: card.projectId,
              nextStep,
              nextStepDue: due,
              termId,
              feeCents: dollarsToCents(fee),
              roles,
              reason: reason.trim(),
            })
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}
