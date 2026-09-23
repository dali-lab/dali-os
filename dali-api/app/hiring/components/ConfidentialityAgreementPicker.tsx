import { useState } from "react";
import { Form } from "react-router";
import { CheckCircle, ChevronRight } from "lucide-react";
import { Select, type SelectOption } from "~/components/ui/floating";
import { buttonClasses } from "~/components/ui/Button";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { Pill, SetupCard, rowTrigger } from "~/hiring/components/cycle-setup/SetupCard";

// Binds a Confidentiality-kind SigningDocument version to a hiring cycle. The
// enclosing route's action handles the `set-confidentiality-agreement` intent
// (create/update/delete the SigningBinding), so this component is
// the same for every cycle.
export function ConfidentialityAgreementPicker({
  currentBinding,
  agreementOptions,
  signatures,
}: {
  currentBinding: any | null;
  agreementOptions: any[];
  signatures: { user: { firstName: string | null; lastName: string | null } }[];
}) {
  const [editing, setEditing] = useState(!currentBinding);
  const [signersOpen, setSignersOpen] = useState(false);
  const currentName =
    currentBinding?.confidentialityAgreementVersion?.agreement?.name ?? null;
  const currentVersion =
    currentBinding?.confidentialityAgreementVersion?.versionNumber ?? null;
  const signatureCount = signatures.length;
  const { fieldLabel, formTrigger } = useOsChrome();

  return (
    <SetupCard
      title="Confidentiality agreement"
      description="Everyone must sign this before seeing applications. Without one, no one can."
      action={
        currentBinding && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className={buttonClasses("secondary", "sm")}>
            Change
          </button>
        ) : null
      }
    >
      {currentBinding && !editing ? (
        <div className="flex flex-col gap-2 rounded-os-item bg-os-well px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <CheckCircle className="w-4 h-4 text-os-green" aria-hidden />
            {currentName ?? "Set"} v{currentVersion}
          </div>
          <button
            type="button"
            onClick={() => setSignersOpen((o) => !o)}
            aria-expanded={signersOpen}
            className="flex items-center gap-1 self-start text-sm text-os-grey hover:text-foreground"
          >
            <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", signersOpen && "rotate-90")} />
            {signatureCount} signature{signatureCount === 1 ? "" : "s"}
          </button>
          {signersOpen && (
            <ul className="ml-5 flex flex-col gap-1 text-sm">
              {signatures.length === 0 ? (
                <li className="text-os-grey">No one has signed yet.</li>
              ) : (
                signatures.map((sig, i) => (
                  <li key={i} className="text-foreground">
                    {`${sig.user.firstName ?? ""} ${sig.user.lastName ?? ""}`.trim() || "Unknown"}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      ) : (
        <Form method="post" className="flex flex-wrap items-end gap-3" onSubmit={() => setEditing(false)}>
          <input type="hidden" name="intent" value="set-confidentiality-agreement" />
          <div className={cn(fieldLabel, "min-w-[14rem] flex-1")}>
            Agreement
            <Select
              name="confidentialityAgreementVersionId"
              defaultValue={currentBinding?.confidentialityAgreementVersion?.id ?? ""}
              placeholder="No agreement"
              options={[
                { value: "", label: "No agreement" },
                ...agreementOptions.flatMap((a: any) =>
                  (a.versions ?? []).map((v: any): SelectOption => ({
                    value: v.id,
                    label: `${a.name} v${v.versionNumber}`,
                  })),
                ),
              ]}
              buttonClassName={rowTrigger(formTrigger)}
            />
          </div>
          <button type="submit" className={buttonClasses("primary", "md", "h-9")}>
            Save
          </button>
          {currentBinding && (
            <button type="button" onClick={() => setEditing(false)} className={buttonClasses("secondary", "md", "h-9")}>
              Cancel
            </button>
          )}
        </Form>
      )}
      {!currentBinding && !editing && <Pill tone="warning">No agreement, cycle data is hidden</Pill>}
    </SetupCard>
  );
}
