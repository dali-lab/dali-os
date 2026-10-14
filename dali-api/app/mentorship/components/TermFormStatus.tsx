import { useId, useState } from "react";
import { useFetcher } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { Select } from "~/components/ui/floating";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type { TermFormResponse, TermFormRole, TermForms } from "../lib/term-forms";

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

// Core picks which form each side fills for the term's week 5 check-in.
export function LinkFormsModal({
  open,
  onClose,
  termId,
  termForms,
  forms,
}: {
  open: boolean;
  onClose: () => void;
  termId: string;
  termForms: TermForms;
  forms: { id: string; name: string }[];
}) {
  const titleId = useId();
  const fetcher = useFetcher();
  const { fieldLabel, formTrigger } = useOsChrome();
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <ModalHeader
        titleId={titleId}
        title="Link week 5 forms"
        subtitle="Each person's response shows next to their name."
        onClose={onClose}
      />
      <div className="flex flex-col gap-4">
        {(["mentee", "mentor"] as const).map((role) => (
          <label key={role} className={fieldLabel}>
            {ROLE_LABELS[role]}
            <Select
              ariaLabel={ROLE_LABELS[role]}
              value={termForms[role].form?.id ?? ""}
              disabled={fetcher.state !== "idle"}
              onChange={(formId) =>
                fetcher.submit({ intent: "link-form", termId, role, formId }, { method: "post" })
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
    </Modal>
  );
}
