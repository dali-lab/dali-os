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

// The week 5 check-in for a whole mentor section, as an assessment-status list:
// the mentor plus every one of their mentees, each with a photo and a status on
// the right. The button opens every form side by side; a submitted row opens
// just that person's form. Naming the week keeps it from reading as the status
// of the whole mentorship.
export function WeekFormsCard({
  week = 5,
  mentor,
  mentees,
}: {
  week?: number;
  mentor: WeekFormSide;
  mentees: WeekFormSide[];
}) {
  const [view, setView] = useState<"all" | string | null>(null);
  const titleId = useId();
  const sides = [mentor, ...mentees];
  const keyOf = (s: WeekFormSide) => `${s.role}-${s.personId}`;
  const anySubmitted = sides.some((s) => s.response);
  const shown = view === "all" ? sides : sides.filter((s) => keyOf(s) === view);
  const single = view !== "all" ? shown[0] : undefined;
  const close = () => setView(null);
  return (
    <div className="flex w-fit flex-col items-stretch">
      <span className="text-sm font-semibold text-foreground">Week {week} Form</span>
      <ul className="mt-2 flex flex-col gap-1">
        {sides.map((s) => {
          const done = Boolean(s.response);
          const inner = (
            <>
              <span className="truncate text-sm font-medium text-foreground">{s.personName}</span>
              <span
                aria-hidden
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                  // Same pastel green as the "Good" week dots; a white disc when missing.
                  done ? "bg-[#9fe0a8]" : "bg-white ring-1 ring-os-container",
                )}
              >
                {done ? (
                  <Check className="h-2.5 w-2.5 text-black/70" strokeWidth={3} />
                ) : (
                  <X className="h-2.5 w-2.5 text-black/50" strokeWidth={3} />
                )}
              </span>
              <span className="sr-only">
                {s.role === "mentor" ? "Mentor" : "Mentee"}, {done ? "submitted" : "not submitted"}
              </span>
            </>
          );
          return (
            <li key={keyOf(s)}>
              {done ? (
                <button
                  type="button"
                  onClick={() => setView(keyOf(s))}
                  aria-label={`Open ${ROLE_FORM_LABEL[s.role]} — ${s.personName}`}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-os-container/40"
                >
                  {inner}
                </button>
              ) : (
                <div className="flex w-full items-center gap-2 px-1.5 py-1">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => setView("all")}
        disabled={!anySubmitted}
        className="os-edit-btn mt-2 self-start !rounded-full !px-3 !py-1 !text-xs disabled:opacity-50"
      >
        {sides.length > 2 ? "View all" : "View both"}
      </button>
      <Modal
        open={view != null}
        onClose={close}
        labelledBy={titleId}
        containerClassName={modalCardClass(
          view === "all" ? (sides.length > 2 ? "max-w-6xl" : "max-w-4xl") : "max-w-lg",
        )}
      >
        <ModalHeader
          titleId={titleId}
          title={single ? `${ROLE_FORM_LABEL[single.role]} · Week ${week}` : `Week ${week} Forms`}
          onClose={close}
        />
        <div
          className="grid gap-6"
          style={
            view === "all"
              ? { gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))" }
              : undefined
          }
        >
          {shown.map((s) => (
            <section
              key={keyOf(s)}
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
    </div>
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
