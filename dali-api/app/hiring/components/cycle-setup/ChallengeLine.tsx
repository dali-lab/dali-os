import { Link, useFetcher } from "react-router";
import { Plus, X } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { Tooltip } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { DomainSubRow, SubRowEmpty } from "./DomainSubRow";
import { AlertIcon } from "./SetupCard";

export type DomainChallenge = {
  forms: { id: string; formId: string; name: string }[];
  /** Who owes a challenge when there's none yet. */
  lead: string | null;
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
  const dialog = useDialog();
  const busy = fetcher.state !== "idle";

  async function removeForm(cdfId: string, name: string) {
    const ok = await dialog.confirm({
      title: `Remove ${name} from this domain's challenge?`,
      description:
        "Applicants who haven't started it lose access. Anyone who already picked it keeps theirs.",
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (!ok) return;
    fetcher.submit({ intent: "remove-challenge-form", cdfId }, { method: "post" });
  }

  return (
    <DomainSubRow
      label="Challenge"
      value={
        challenge.forms.length === 0 ? (
          <SubRowEmpty>None yet{challenge.lead ? ` · ${challenge.lead}` : ""}</SubRowEmpty>
        ) : (
          challenge.forms.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1">
              <Link to={`/forms/edit/${f.formId}`} className="hover:underline">
                {f.name}
              </Link>
              {editable && (
                <Tooltip content="Remove">
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${f.name}`}
                    onClick={() => void removeForm(f.id, f.name)}
                    className="rounded-os-item p-0.5 text-os-grey hover:bg-os-container hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              )}
            </span>
          ))
        )
      }
      action={
        editable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => fetcher.submit({ intent: "create-challenge-form", domainId }, { method: "post" })}
            className={buttonClasses("secondary", "sm")}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> {busy ? "Adding…" : "Add challenge"}
          </button>
        )
      }
    />
  );
}

/** Marks a domain that isn't ready yet; ready domains show nothing. */
export function NotReadyIcon() {
  return <AlertIcon label="Not ready" />;
}
