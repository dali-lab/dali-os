import { useId, useState } from "react";
import { useFetcher } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { Select } from "~/components/ui/floating";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import {
  domainTermForms,
  type TermFormResponse,
  type TermFormRole,
  type TermForms,
} from "../lib/term-forms";

const PILL = "inline-flex items-center gap-1.5 rounded-full bg-os-container px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";

// One person's answer to a linked form: a pill that opens the response, or a
// quiet "Not submitted".
export function TermFormStatus({
  response,
  formName,
  personName,
}: {
  response: TermFormResponse | undefined;
  formName: string;
  personName: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  if (!response) {
    return (
      <span className={cn(PILL, "text-os-grey")}>
        <span className="h-2 w-2 rounded-full bg-os-grey" aria-hidden />
        Not submitted
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(PILL, "text-foreground hover:bg-os-container-hi transition-colors")}
      >
        <span className="h-2 w-2 rounded-full bg-os-green" aria-hidden />
        Submitted
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy={titleId} containerClassName={modalCardClass("max-w-lg")}>
        <ModalHeader
          titleId={titleId}
          title={personName}
          subtitle={`${formName} · ${new Date(response.submittedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
          onClose={() => setOpen(false)}
        />
        <dl className="flex flex-col gap-3">
          {response.rows.map((row) => (
            <div key={row.key}>
              <dt className="text-xs font-medium text-muted-foreground mb-0.5">{row.label}</dt>
              <dd className="text-sm text-foreground whitespace-pre-wrap">{row.value || "None"}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  );
}

const ROLE_LABELS: Record<TermFormRole, string> = { mentee: "Mentee form", mentor: "Mentor form" };

// Core picks which form each side fills for the term's week 5 check-in. Domains
// are tabs on the left; the selected domain's forms are on the right.
export function LinkFormsModal({
  open,
  onClose,
  termId,
  domains,
  initialDomainId,
  termForms,
  forms,
}: {
  open: boolean;
  onClose: () => void;
  termId: string;
  domains: { id: string; label: string }[];
  initialDomainId: string;
  termForms: TermForms;
  forms: { id: string; name: string }[];
}) {
  const titleId = useId();
  const fetcher = useFetcher();
  const { fieldLabel, formTrigger } = useOsChrome();
  const [domainId, setDomainId] = useState(initialDomainId || domains[0]?.id || "");
  const linked = domainTermForms(termForms, domainId);
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      containerClassName={modalCardClass("max-w-2xl")}
    >
      <ModalHeader
        titleId={titleId}
        title="Link week 5 forms"
        subtitle="Each person's response shows next to their name."
        onClose={onClose}
      />
      {domains.length === 0 ? (
        <p className="text-sm text-muted-foreground">No domains have pairs yet.</p>
      ) : (
        <div className="flex gap-6">
          <div
            role="tablist"
            aria-label="Domains"
            aria-orientation="vertical"
            className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-os-container pr-3"
          >
            {domains.map((d) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={d.id === domainId}
                onClick={() => setDomainId(d.id)}
                className={cn(
                  "rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  d.id === domainId
                    ? "bg-os-container font-semibold text-foreground"
                    : "text-os-grey hover:text-foreground",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="flex min-w-0 flex-1 flex-col gap-4">
            {(["mentee", "mentor"] as const).map((role) => (
              <label key={role} className={fieldLabel}>
                {ROLE_LABELS[role]}
                <Select
                  ariaLabel={ROLE_LABELS[role]}
                  value={linked[role].form?.id ?? ""}
                  disabled={fetcher.state !== "idle"}
                  onChange={(formId) =>
                    fetcher.submit(
                      { intent: "link-form", termId, domainId, role, formId },
                      { method: "post" },
                    )
                  }
                  options={[
                    { value: "", label: "None" },
                    ...forms.map((f) => ({ value: f.id, label: f.name })),
                  ]}
                  buttonClassName={formTrigger}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
