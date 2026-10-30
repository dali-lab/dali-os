import { useId, useState } from "react";
import { Link } from "react-router";
import { Folder, Minus, Plus } from "lucide-react";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { Select } from "~/components/ui/floating";
import { DateField } from "~/components/ui/DateField";
import { buttonClasses } from "~/components/ui/Button";
import { useOsChrome } from "~/components/os-chrome";
import {
  RENEWAL_COLUMNS,
  RENEWAL_COLUMN_LABELS,
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
  "w-full rounded-os-item border border-os-border bg-os-card px-3 py-2 text-sm text-foreground";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

export function RenewalModal({
  card,
  initialDecision,
  decisionTerm,
  termOptions,
  domains,
  busy,
  onClose,
  onSave,
}: {
  card: RenewalCardModel;
  initialDecision: RenewalColumn;
  decisionTerm: TermOption;
  termOptions: TermOption[];
  domains: DomainOption[];
  busy: boolean;
  onClose: () => void;
  onSave: (v: RenewalSubmission) => void;
}) {
  const titleId = useId();
  const { formClass } = useOsChrome();
  const [decision, setDecision] = useState<RenewalColumn>(initialDecision);
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
    <Modal open onClose={onClose} labelledBy={titleId}>
      <ModalHeader
        titleId={titleId}
        title={
          <span className="flex items-center gap-2">
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-os-item bg-os-container text-base">
              {card.iconEmoji ?? <Folder className="h-4 w-4 text-muted-foreground" />}
            </span>
            <span className="min-w-0 truncate">{card.name}</span>
          </span>
        }
        subtitle={`${card.orgName ? `${card.orgName} · ` : ""}${card.termCount} ${card.termCount === 1 ? "term" : "terms"}`}
        onClose={onClose}
        actions={
          <Link to={`/projects/${card.projectId}`} className={buttonClasses("ghost", "sm")}>
            Open project
          </Link>
        }
      />
      <div className={`${formClass} flex flex-col gap-4`}>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Decision for {decisionTerm.code}</FieldLabel>
          <SegmentedTabButtons
            label="Decision"
            stretch
            size="sm"
            items={RENEWAL_COLUMNS.map((c) => ({
              label: RENEWAL_COLUMN_LABELS[c],
              active: decision === c,
              onClick: () => setDecision(c),
            }))}
          />
        </div>

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
              className={inputClass}
              placeholder="Why is this project not continuing?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
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
        </div>
      </div>
      <ModalFooter onCancel={onClose}>
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
      </ModalFooter>
    </Modal>
  );
}
