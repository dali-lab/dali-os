import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { Plus, X } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { Select, Tooltip } from "~/components/ui/floating";
import { formatVersionName, type VersionLabelInput } from "~/lib/formatVersion";
import { DomainSubRow, SubRowEmpty, SubRowVersion } from "./DomainSubRow";
import { AlertIcon, rowTrigger } from "./SetupCard";

export type DomainChallenge = {
  forms: ({ id: string; formId: string } & VersionLabelInput)[];
  /** Existing forms the lead can still link as a challenge. */
  pickable: { id: string; name: string }[];
};

// A domain's challenge forms on its setup row, each linking to its editor.
// Adding and removing follow the domain-lead page's rules (Draft only, and a
// form an applicant already picked stays), enforced server-side.
export function ChallengeLine({
  domainId,
  challenge,
  editable,
}: {
  domainId: string;
  challenge: DomainChallenge;
  /** The cycle is in Draft, so challenges can still be added or removed. */
  editable: boolean;
}) {
  const fetcher = useFetcher();
  const { formTrigger } = useOsChrome();
  const busy = fetcher.state !== "idle";
  const [picking, setPicking] = useState(false);
  const small = buttonClasses("secondary", "sm");
  const add = (formId?: string) => {
    setPicking(false);
    fetcher.submit({ intent: "create-challenge-form", domainId, ...(formId && { formId }) }, { method: "post", preventScrollReset: true });
  };
  return (
    <DomainSubRow
      label="Challenge"
      value={
        challenge.forms.length === 0 ? (
          <SubRowEmpty>None yet</SubRowEmpty>
        ) : (
          challenge.forms.map((f) => (
            <SubRowVersion key={f.id} version={f}>
              <Link to={`/forms/edit/${f.formId}`} className="min-w-0 truncate hover:underline">
                {formatVersionName(f)}
              </Link>
              {editable && (
                <Tooltip content="Remove">
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${f.name}`}
                    onClick={() => fetcher.submit({ intent: "remove-challenge-form", cdfId: f.id }, { method: "post", preventScrollReset: true })}
                    className="rounded-os-item p-0.5 text-os-grey hover:bg-os-container hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              )}
            </SubRowVersion>
          ))
        )
      }
      action={
        editable &&
        !picking && (
          <button type="button" disabled={busy} onClick={() => setPicking(true)} className={small}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> {busy ? "Adding…" : "Add challenge"}
          </button>
        )
      }
      editor={
        editable &&
        picking && (
          <div className="flex flex-wrap items-center gap-2">
            {challenge.pickable.length > 0 && (
              <div className="min-w-[14rem] flex-1">
                <Select
                  ariaLabel="Challenge form"
                  defaultValue=""
                  placeholder="Pick a form"
                  onChange={(id) => id && add(id)}
                  options={challenge.pickable.map((f) => ({ value: f.id, label: f.name }))}
                  buttonClassName={rowTrigger(formTrigger)}
                />
              </div>
            )}
            <button type="button" onClick={() => add()} className={small}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> New form
            </button>
            <button type="button" onClick={() => setPicking(false)} className={small}>
              Cancel
            </button>
          </div>
        )
      }
    />
  );
}

/** Marks a domain that isn't ready yet; ready domains show nothing. */
export function NotReadyIcon() {
  return <AlertIcon label="Not ready" />;
}
