// The application record's right-hand property panel — shared by
// PartnerApplicationModal and the full detail page. Saves route through
// the detail route's action intents (see partner-detail-fetch.ts for why a
// plain fetch(), not a <Form>/fetcher, is what lets this work from the modal
// too) except Stage, which the design calls out as posting straight to the
// status endpoint, and Domains, which go through their own existing API
// routes.

import { useState } from "react";
import { Link } from "react-router";
import { Plus, X } from "lucide-react";
import { Select, MultiSelect } from "~/components/ui/floating";
import { DateField } from "~/components/ui/DateField";
import { PropRow, PROP_CONTROL } from "~/components/ui/modal-fields";
import { useToast } from "~/components/ui/toast";
import {
  PARTNER_STAGES,
  PARTNER_STAGE_LABELS,
  type PartnerStage,
} from "../../lib/partner-application";
import type { ApplicationDetail } from "../../lib/partner-application-detail";
import type { PartnerContractStatus } from "../../lib/partner-contract.server";
import type { ProjectFundingType } from "~/lib/chart-string";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";
import { SowStatePanel } from "./SowStatePanel";
import { ContractPanel } from "./ContractPanel";
import { FinancePanel } from "./FinancePanel";

// Only the fields this panel actually reads — a Pick rather than the full
// ApplicationDetail so the full detail page (whose loader shapes target
// terms differently — {termId, code} there, {id, code} here) can adapt a
// small projection instead of reshaping its own loader return for every
// other consumer in that file.
export type PropertyRailApplication = Pick<
  ApplicationDetail,
  | "id"
  | "stage"
  | "applicant"
  | "partner"
  | "resultingProjectId"
  | "source"
  | "nextStep"
  | "nextStepDueAt"
  | "holdUntil"
  | "targetTerms"
  | "summary"
  | "domains"
  | "fundingType"
  | "feeCents"
  | "legalEntityName"
  | "legalEntityAddress"
  | "paymentSchedule"
  | "sowState"
  | "contractBindingId"
>;

export function PropertyRail({
  application,
  canEdit,
  domainOptions,
  termOptions,
  contract,
  contractDocuments,
  financeOn,
  onChanged,
}: {
  application: PropertyRailApplication;
  canEdit: boolean;
  /** Domains not yet attached to this application — the "add scope" picker. */
  domainOptions: { id: string; name: string }[];
  termOptions: { id: string; code: string }[];
  contract: PartnerContractStatus;
  /** PartnerContract-kind SigningDocuments with a published version — empty when the viewer can't edit. */
  contractDocuments: { id: string; title: string }[];
  financeOn: boolean;
  onChanged: () => void;
}) {
  const [stageBusy, setStageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function changeStage(next: PartnerStage) {
    setStageBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partner-applications/${application.id}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: next }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change stage.");
    } finally {
      setStageBusy(false);
    }
  }

  async function run(intent: string, fields: Record<string, string | string[] | null>) {
    setError(null);
    const res = await postPartnerApplicationIntent(application.id, intent, fields);
    if (!res.ok) {
      setError(res.error ?? "Couldn't save.");
      return false;
    }
    onChanged();
    return true;
  }

  return (
    <div className="flex flex-col gap-1">
      {error && <p className="text-xs text-destructive">{error}</p>}

      <PropRow label="Stage">
        <Select
          value={application.stage}
          disabled={!canEdit || stageBusy}
          onChange={(v) => void changeStage(v as PartnerStage)}
          options={PARTNER_STAGES.map((s) => ({ value: s, label: PARTNER_STAGE_LABELS[s] }))}
          buttonClassName={PROP_CONTROL}
        />
      </PropRow>

      <PropRow label="Contact">
        <Link
          to={`/core/partners/contacts/${application.applicant.id}`}
          className="text-sm text-accent-coral hover:underline"
        >
          {application.applicant.name}
        </Link>
      </PropRow>

      <PropRow label="Organization">
        {application.partner ? (
          <Link
            to={`/core/partners/orgs/${application.partner.id}`}
            className="text-sm text-accent-coral hover:underline"
          >
            {application.partner.name}
          </Link>
        ) : application.resultingProjectId ? (
          <Link
            to={`/projects/${application.resultingProjectId}`}
            className="text-sm text-accent-coral hover:underline"
          >
            Created at project
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">Not yet</span>
        )}
      </PropRow>

      <PropRow label="Source">
        <span className="text-sm text-foreground">{application.source}</span>
      </PropRow>

      <NextStepField application={application} canEdit={canEdit} run={run} />
      <PausedUntilField application={application} canEdit={canEdit} run={run} />

      <PropRow label="Target terms">
        <MultiSelect
          values={application.targetTerms.map((t) => t.id)}
          disabled={!canEdit}
          onChange={(ids) =>
            void run("details", {
              summary: application.summary ?? "",
              targetTermId: ids,
            }).then((ok) => {
              if (!ok) toast.error("Couldn't save target terms.");
            })
          }
          options={termOptions.map((t) => ({ value: t.id, label: t.code }))}
          ariaLabel="Target terms"
          placeholder="None"
          emptyLabel="No terms"
          buttonClassName={PROP_CONTROL}
        />
      </PropRow>

      <DomainsField
        applicationId={application.id}
        domains={application.domains}
        availableDomains={domainOptions}
        canEdit={canEdit}
        onChanged={onChanged}
      />

      <PropRow label="SOW">
        <div className="flex flex-col gap-1.5">
          <Link
            to={`/core/partners/applications/${application.id}?tab=sow`}
            className="self-start text-sm text-accent-coral hover:underline"
          >
            Open
          </Link>
          <SowStatePanel
            applicationId={application.id}
            sowState={application.sowState}
            canEdit={canEdit}
            onChanged={onChanged}
            compact
          />
        </div>
      </PropRow>

      <PropRow label="Contract">
        <ContractPanel
          applicationId={application.id}
          status={contract}
          documents={contractDocuments}
          canSend={canEdit}
          onChanged={onChanged}
          compact
        />
      </PropRow>

      {financeOn && (
        <FinancePanel
          applicationId={application.id}
          fundingType={application.fundingType as ProjectFundingType | null}
          feeCents={application.feeCents}
          legalEntityName={application.legalEntityName}
          legalEntityAddress={application.legalEntityAddress}
          paymentSchedule={application.paymentSchedule}
          canEdit={canEdit}
          onChanged={onChanged}
        />
      )}

      {application.resultingProjectId && (
        <PropRow label="Project">
          <Link
            to={`/projects/${application.resultingProjectId}`}
            className="text-sm text-accent-coral hover:underline"
          >
            View project
          </Link>
        </PropRow>
      )}
    </div>
  );
}

type RunFn = (intent: string, fields: Record<string, string | string[] | null>) => Promise<boolean>;

function NextStepField({
  application,
  canEdit,
  run,
}: {
  application: PropertyRailApplication;
  canEdit: boolean;
  run: RunFn;
}) {
  const [nextStep, setNextStep] = useState(application.nextStep ?? "");
  const [dueDate, setDueDate] = useState(
    application.nextStepDueAt ? application.nextStepDueAt.slice(0, 10) : "",
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await run("next-step", {
      nextStep: nextStep.trim() || null,
      nextStepDueAt: dueDate ? `${dueDate}T00:00:00.000Z` : null,
    });
    setBusy(false);
  }

  if (!canEdit) {
    return (
      <PropRow label="Next step">
        <span className="text-sm text-foreground">
          {application.nextStep ?? "—"}
          {application.nextStepDueAt && ` · due ${application.nextStepDueAt.slice(0, 10)}`}
        </span>
      </PropRow>
    );
  }

  return (
    <PropRow label="Next step">
      <div className="flex flex-col gap-1.5">
        <input
          type="text"
          value={nextStep}
          onChange={(e) => setNextStep(e.target.value)}
          onBlur={save}
          disabled={busy}
          placeholder="What's next?"
          className={PROP_CONTROL}
        />
        <DateField
          mode="date"
          value={dueDate}
          onChange={(v) => {
            setDueDate(v);
            void run("next-step", {
              nextStep: nextStep.trim() || null,
              nextStepDueAt: v ? `${v}T00:00:00.000Z` : null,
            });
          }}
          ariaLabel="Next step due date"
          className="w-full"
        />
      </div>
    </PropRow>
  );
}

function PausedUntilField({
  application,
  canEdit,
  run,
}: {
  application: PropertyRailApplication;
  canEdit: boolean;
  run: RunFn;
}) {
  const [holdUntil, setHoldUntil] = useState(
    application.holdUntil ? application.holdUntil.slice(0, 10) : "",
  );

  if (!canEdit) {
    return (
      <PropRow label="Paused until">
        <span className="text-sm text-foreground">
          {application.holdUntil ? application.holdUntil.slice(0, 10) : "—"}
        </span>
      </PropRow>
    );
  }

  return (
    <PropRow label="Paused until">
      <div className="flex items-center gap-1.5">
        <DateField
          mode="date"
          value={holdUntil}
          onChange={(v) => {
            setHoldUntil(v);
            void run("hold", { holdUntil: v ? `${v}T00:00:00.000Z` : null });
          }}
          ariaLabel="Paused until"
          className="w-full"
        />
        {holdUntil && (
          <button
            type="button"
            onClick={() => {
              setHoldUntil("");
              void run("hold", { holdUntil: null });
            }}
            aria-label="Clear paused-until date"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </PropRow>
  );
}

function DomainsField({
  applicationId,
  domains,
  availableDomains,
  canEdit,
  onChanged,
}: {
  applicationId: string;
  domains: ApplicationDetail["domains"];
  availableDomains: { id: string; name: string }[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newDomainId, setNewDomainId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addDomain() {
    if (!newDomainId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partner-applications/${applicationId}/domains`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId: newDomainId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      setAdding(false);
      setNewDomainId("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that domain.");
    } finally {
      setBusy(false);
    }
  }

  async function setExpectedMembers(domainRowId: string, expectedMembers: number, expectedChallenges: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partner-application-domains/${domainRowId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedMembers, expectedChallenges }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function removeDomain(domainRowId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partner-application-domains/${domainRowId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that domain.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PropRow label="Domains">
      <div className="flex flex-col gap-1.5">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {domains.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        {domains.map((d) => (
          <div key={d.id} className="flex items-center gap-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate text-foreground">{d.domainName}</span>
            {canEdit ? (
              <input
                type="number"
                min={0}
                defaultValue={d.expectedMembers}
                disabled={busy}
                onBlur={(e) => {
                  const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                  if (n !== d.expectedMembers) void setExpectedMembers(d.id, n, d.expectedChallenges);
                }}
                aria-label={`Expected members for ${d.domainName}`}
                className="w-14 rounded-md border border-border bg-background px-1.5 py-0.5 text-right text-xs"
              />
            ) : (
              <span className="text-xs text-muted-foreground">{d.expectedMembers}</span>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => void removeDomain(d.id)}
                disabled={busy}
                aria-label={`Remove ${d.domainName}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        ))}
        {canEdit && availableDomains.length > 0 && (
          adding ? (
            <div className="flex items-center gap-1.5">
              <Select
                value={newDomainId}
                onChange={setNewDomainId}
                placeholder="Choose a domain…"
                options={availableDomains.map((d) => ({ value: d.id, label: d.name }))}
                buttonClassName="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs inline-flex items-center justify-between gap-1"
              />
              <button
                type="button"
                onClick={() => void addDomain()}
                disabled={!newDomainId || busy}
                className="text-xs font-medium text-accent-coral hover:underline disabled:opacity-60"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="text-xs text-muted-foreground hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 self-start text-xs font-medium text-accent-coral hover:underline"
            >
              <Plus className="h-3 w-3" aria-hidden /> Add domain
            </button>
          )
        )}
      </div>
    </PropRow>
  );
}
