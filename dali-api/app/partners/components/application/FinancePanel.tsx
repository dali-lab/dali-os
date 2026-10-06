// Deal terms for one application — funding type, fee, legal entity, payment
// schedule. These feed the contract's merge variables (see
// resolvePartnerContractVariables). Posts the EXISTING intent "deal-terms" to
// the application detail route's action (unchanged by this feature) — this
// panel is just a reusable, consistently-styled editor for those same fields.

import { useState } from "react";
import { CircleDollarSign } from "lucide-react";
import { Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { PROJECT_FUNDING_TYPES, PROJECT_FUNDING_TYPE_LABELS, type ProjectFundingType } from "~/lib/chart-string";
import { formatUsd } from "~/lib/money";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";

export function FinancePanel({
  applicationId,
  fundingType,
  feeCents,
  legalEntityName,
  legalEntityAddress,
  paymentSchedule,
  canEdit,
  onChanged,
}: {
  applicationId: string;
  fundingType: ProjectFundingType | null;
  feeCents: number | null;
  legalEntityName: string | null;
  legalEntityAddress: string | null;
  paymentSchedule: string | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [funding, setFunding] = useState<ProjectFundingType | "">(fundingType ?? "");
  const [feeDollars, setFeeDollars] = useState(feeCents != null ? String(feeCents / 100) : "");
  const [entityName, setEntityName] = useState(legalEntityName ?? "");
  const [entityAddress, setEntityAddress] = useState(legalEntityAddress ?? "");
  const [schedule, setSchedule] = useState(paymentSchedule ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral/30";

  async function save() {
    setSaving(true);
    setError(null);
    const dollars = feeDollars.trim();
    const feeCentsValue = dollars ? Math.round(Number(dollars) * 100) : null;
    if (dollars && (feeCentsValue === null || isNaN(feeCentsValue))) {
      setSaving(false);
      setError("Invalid fee.");
      return;
    }
    const res = await postPartnerApplicationIntent(applicationId, "deal-terms", {
      fundingType: funding || undefined,
      feeCents: feeCentsValue != null ? String(feeCentsValue) : "",
      legalEntityName: entityName.trim(),
      legalEntityAddress: entityAddress.trim(),
      paymentSchedule: schedule.trim(),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't save deal terms.");
      return;
    }
    onChanged();
  }

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
        Deal terms
      </h2>

      {canEdit ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-foreground/80">Funding type</span>
            <Select
              value={funding}
              onChange={(v) => setFunding(v as ProjectFundingType)}
              options={PROJECT_FUNDING_TYPES.map((t) => ({ value: t, label: PROJECT_FUNDING_TYPE_LABELS[t] }))}
              buttonClassName="px-2.5 py-1.5 border border-border rounded-md inline-flex items-center justify-between gap-1 text-sm hover:bg-muted/40"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-foreground/80">Fee (USD)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={feeDollars}
              onChange={(e) => setFeeDollars(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-foreground/80">Legal entity name</span>
            <input
              type="text"
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-foreground/80">Legal entity address</span>
            <input
              type="text"
              value={entityAddress}
              onChange={(e) => setEntityAddress(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            <span className="font-medium text-foreground/80">Payment schedule</span>
            <input
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="e.g. Net 30 on invoice"
              className={inputClass}
            />
          </label>
          <div className="sm:col-span-2 flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save deal terms"}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>
      ) : (
        <dl className="grid gap-2 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Funding type</dt>
            <dd className="text-foreground">{fundingType ? PROJECT_FUNDING_TYPE_LABELS[fundingType] : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Fee</dt>
            <dd className="text-foreground">{feeCents != null ? formatUsd(feeCents / 100) : "—"}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
