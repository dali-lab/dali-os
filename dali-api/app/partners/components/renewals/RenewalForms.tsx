import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Select } from "~/components/ui/floating";
import { buttonClasses } from "~/components/ui/Button";
import {
  addDomainRole,
  centsToDollars,
  dollarsToCents,
  stepSlots,
  type RenewalCardModel,
  type RenewalRole,
} from "../../lib/partner-renewals";

export type TermOption = { id: string; code: string };
export type DomainOption = { id: string; name: string };

const stop = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

const inputClass =
  "w-full rounded-os-item border border-os-border bg-os-card px-2 py-1 text-xs text-foreground";

export function ContinueForm({
  card,
  decisionTermId,
  termOptions,
  domains,
  busy,
  onCancel,
  onConfirm,
}: {
  card: RenewalCardModel;
  decisionTermId: string;
  termOptions: TermOption[];
  domains: DomainOption[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (v: { termId: string; roles: RenewalRole[]; feeCents: number | null }) => void;
}) {
  const [termId, setTermId] = useState(decisionTermId);
  const [roles, setRoles] = useState<RenewalRole[]>(card.lastRoles);
  const [fee, setFee] = useState(centsToDollars(card.feeCents));
  const addable = domains.filter((d) => !roles.some((r) => r.domainId === d.id));

  return (
    <div {...stop} className="mt-3 flex flex-col gap-2 border-t border-os-border pt-3 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-os-grey">Term</span>
        <Select
          ariaLabel="Term"
          value={termId}
          onChange={setTermId}
          options={termOptions.map((t) => ({ value: t.id, label: t.code }))}
        />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-os-grey">Spots</span>
        {roles.map((r) => (
          <div key={r.domainId} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">{r.name}</span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`Fewer ${r.name}`}
                className="rounded p-0.5 hover:bg-os-container"
                onClick={() => setRoles((cur) => stepSlots(cur, r.domainId, -1))}
              >
                <Minus className="h-3.5 w-3.5" aria-hidden />
              </button>
              <span className="w-5 text-center tabular-nums">{r.slots}</span>
              <button
                type="button"
                aria-label={`More ${r.name}`}
                className="rounded p-0.5 hover:bg-os-container"
                onClick={() => setRoles((cur) => stepSlots(cur, r.domainId, 1))}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
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
      <label className="flex flex-col gap-1">
        <span className="text-os-grey">Fee</span>
        <input
          className={inputClass}
          inputMode="decimal"
          placeholder="Dollars"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClasses("ghost", "xs")} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          className={buttonClasses("primary", "xs")}
          onClick={() => onConfirm({ termId, roles, feeCents: dollarsToCents(fee) })}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

export function ReasonForm({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div {...stop} className="mt-3 flex flex-col gap-2 border-t border-os-border pt-3 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-os-grey">Reason</span>
        <input
          className={inputClass}
          placeholder="Why is this project not continuing?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClasses("ghost", "xs")} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !reason.trim()}
          className={buttonClasses("primary", "xs")}
          onClick={() => onConfirm(reason.trim())}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
