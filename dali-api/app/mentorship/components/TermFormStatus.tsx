import { useId, useState } from "react";
import { Check, X } from "lucide-react";
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

export type WeekFormSide = {
  role: "mentor" | "mentee";
  personId: string;
  personName: string;
  photoUrl: string | null;
  // Null when no form is linked for this side's domain.
  formName: string | null;
  response: TermFormResponse | undefined;
};

const ROLE_FORM_LABEL = { mentor: "Mentor Form", mentee: "Mentee Form" } as const;

function formDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A small submitted / not-submitted marker: the pastel green of the "Good" week
// dots with a check, or a white disc with an x. The words stay for screen readers.
export function FormStateBadge({ done, label, size = "md" }: { done: boolean; label: string; size?: "sm" | "md" }) {
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full",
          size === "sm" ? "h-3 w-3" : "h-4 w-4",
          done ? "bg-[#9fe0a8]" : "bg-white ring-1 ring-os-container",
        )}
      >
        {done ? (
          <Check className={size === "sm" ? "h-2 w-2 text-black/70" : "h-2.5 w-2.5 text-black/70"} strokeWidth={3} />
        ) : (
          <X className={size === "sm" ? "h-2 w-2 text-black/50" : "h-2.5 w-2.5 text-black/50"} strokeWidth={3} />
        )}
      </span>
      <span className="sr-only">{label}, {done ? "submitted" : "not submitted"}</span>
    </>
  );
}

// Every given person's week check-in form, side by side in one overlay — the
// mentor and a mentee, or a mentor and all of their mentees.
export function WeekFormsDialog({
  open,
  onClose,
  week = 5,
  sides,
}: {
  open: boolean;
  onClose: () => void;
  week?: number;
  sides: WeekFormSide[];
}) {
  const titleId = useId();
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      containerClassName={modalCardClass(sides.length > 2 ? "max-w-6xl" : sides.length > 1 ? "max-w-4xl" : "max-w-lg")}
    >
      <ModalHeader titleId={titleId} title={`Week ${week} Forms`} onClose={onClose} />
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))" }}
      >
        {sides.map((s) => (
          <section
            key={`${s.role}-${s.personId}`}
            aria-label={ROLE_FORM_LABEL[s.role]}
            className="flex min-w-0 flex-col gap-3 rounded-xl bg-os-container/40 p-4"
          >
            <header className="flex flex-col gap-0.5 border-b border-os-container pb-3">
              <span className="text-sm font-semibold text-foreground">{s.personName}</span>
              <span className="text-xs text-muted-foreground">
                {[s.role === "mentor" ? "Mentor" : "Mentee", s.formName, s.response && formDate(s.response.submittedAt)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                <FormStateBadge done={Boolean(s.response)} label={ROLE_FORM_LABEL[s.role]} />
                {s.response ? "Submitted" : "Not submitted"}
              </span>
            </header>
            {s.response ? (
              <dl className="flex flex-col gap-3">
                {s.response.rows.map((row) => (
                  <div key={row.key}>
                    <dt className="text-xs font-medium text-muted-foreground mb-0.5">{row.label}</dt>
                    <dd className="text-sm text-foreground whitespace-pre-wrap">{row.value || "None"}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-os-grey">Not submitted yet.</p>
            )}
          </section>
        ))}
      </div>
    </Modal>
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
