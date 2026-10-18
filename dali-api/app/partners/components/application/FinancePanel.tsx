// Deal terms for one application — funding type, fee, legal entity, payment
// schedule. These feed the contract's merge variables (see
// resolvePartnerContractVariables). Posts the EXISTING intent "deal-terms" to
// the application detail route's action (unchanged by this feature) — this
// panel is just a reusable, consistently-styled editor for those same fields.

import { useState } from "react";
import { Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { PROJECT_FUNDING_TYPES, PROJECT_FUNDING_TYPE_LABELS, type ProjectFundingType } from "~/lib/chart-string";
import { formatUsd } from "~/lib/money";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";
import { RAIL_CONTROL, RailFact, RailField } from "./rail";

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
    <div className="flex flex-col gap-3">
      {canEdit ? (
        <>
          <RailField label="Funding type">
            <Select
              value={funding}
              onChange={(v) => setFunding(v as ProjectFundingType)}
              options={PROJECT_FUNDING_TYPES.map((t) => ({ value: t, label: PROJECT_FUNDING_TYPE_LABELS[t] }))}
              placeholder="Choose"
              ariaLabel="Funding type"
              buttonClassName={RAIL_CONTROL}
            />
          </RailField>
          <RailField label="Fee (USD)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={feeDollars}
              onChange={(e) => setFeeDollars(e.target.value)}
              aria-label="Fee (USD)"
              className={RAIL_CONTROL}
            />
          </RailField>
          <RailField label="Legal entity">
            <input
              type="text"
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
              aria-label="Legal entity name"
              className={RAIL_CONTROL}
            />
          </RailField>
          <RailField label="Entity address">
            <input
              type="text"
              value={entityAddress}
              onChange={(e) => setEntityAddress(e.target.value)}
              aria-label="Legal entity address"
              className={RAIL_CONTROL}
            />
          </RailField>
          <RailField label="Payment schedule">
            <input
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="e.g. Net 30 on invoice"
              aria-label="Payment schedule"
              className={RAIL_CONTROL}
            />
          </RailField>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="xs" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save deal terms"}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </>
      ) : (
        <>
          <RailFact label="Funding type">{fundingType ? PROJECT_FUNDING_TYPE_LABELS[fundingType] : "Not set"}</RailFact>
          <RailFact label="Fee">{feeCents != null ? formatUsd(feeCents / 100) : "Not set"}</RailFact>
        </>
      )}
    </div>
  );
}
