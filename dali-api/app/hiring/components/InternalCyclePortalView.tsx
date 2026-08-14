import { useMemo, useState } from "react";
import { useFetcher, Link } from "react-router";
import type { Question } from "~/types";
import { FormFieldList } from "~/forms/components/FormField";
import { useFormPager, FormPageHeading } from "~/forms/components/FormPager";
import { paginateQuestions } from "~/lib/form-pages";
import { formatInstantWithZoneLabel } from "~/lib/timezone";
import { Checkbox } from "~/components/ui/Checkbox";
import type { PortalLoaderData, PortalDomain } from "~/hiring/lib/internal-cycle-portal.server";

// Per-cycle copy for the shared internal-cycle applicant portal.
export interface PortalCopy {
  heading: string;
  notMember: string;
  notEligible: string;
  noActiveCycleTitle: string;
  noActiveCycleBody: string;
  submittedBody: string;
  withdrawnBody: string;
  contextHint?: (domains: PortalDomain[]) => React.ReactNode;
  domainSectionHint?: string;
}

export function InternalCyclePortalView({
  data,
  copy,
}: {
  data: PortalLoaderData;
  copy: PortalCopy;
}) {
  if (data.reason === "not-member") {
    return <Message title="Not available">{copy.notMember}</Message>;
  }
  if (data.reason === "not-eligible") {
    return <Message title="Not eligible">{copy.notEligible}</Message>;
  }
  if (data.reason === "no-active-cycle") {
    return <Message title={copy.noActiveCycleTitle}>{copy.noActiveCycleBody}</Message>;
  }

  const { cycle, contextDomains, draft, viewerTimeZone, showDomainPicker } = data;
  const submitted = draft?.status === "Submitted";
  const withdrawn = draft?.status === "Withdrawn";

  return (
    <div className="max-w-3xl mx-auto py-10 px-6">
      <header className="mb-8">
        <h1 className="font-heading text-2xl font-bold text-dark-blue mb-1">{copy.heading}</h1>
        <p className="text-sm text-muted-foreground">
          {cycle.name}
          {cycle.closeDate && ` · closes ${formatInstantWithZoneLabel(cycle.closeDate, viewerTimeZone)}`}
        </p>
        {copy.contextHint && contextDomains.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">{copy.contextHint(contextDomains)}</p>
        )}
      </header>

      {withdrawn ? (
        <Message title="Application withdrawn">{copy.withdrawnBody}</Message>
      ) : submitted ? (
        <SubmittedView submittedBody={copy.submittedBody} />
      ) : (
        <FormView
          cycle={cycle}
          showDomainPicker={showDomainPicker}
          domainSectionHint={copy.domainSectionHint}
          submittedBody={copy.submittedBody}
          initial={draft ?? { answers: {}, selectedDomainIds: [] }}
        />
      )}
    </div>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl mx-auto py-16 px-6 text-center">
      <h2 className="font-heading text-xl font-bold text-dark-blue mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground">{children}</p>
      <Link to="/" className="mt-6 inline-block text-sm text-accent-coral hover:underline">
        Open home
      </Link>
    </div>
  );
}

function FormView({
  cycle,
  showDomainPicker,
  domainSectionHint,
  submittedBody,
  initial,
}: {
  cycle: {
    id: string;
    questions: Question[];
    targetDomains: PortalDomain[];
  };
  showDomainPicker: boolean;
  domainSectionHint?: string;
  submittedBody: string;
  initial: { answers: Record<string, string>; selectedDomainIds: string[] };
}) {
  const fetcher = useFetcher();
  const [answers, setAnswers] = useState<Record<string, string>>(initial.answers);
  const [selectedDomainIds, setSelectedDomainIds] = useState<string[]>(initial.selectedDomainIds);
  const [error, setError] = useState<string | null>(null);
  const pages = useMemo(() => paginateQuestions(cycle.questions), [cycle.questions]);
  const pager = useFormPager(pages, { excludeFileType: false });

  const busy = fetcher.state !== "idle";
  const justSaved = fetcher.data && "saved" in fetcher.data && fetcher.state === "idle";
  const submitted = fetcher.data && "submitted" in fetcher.data;

  function submitForm(intent: "save-draft" | "submit") {
    setError(null);
    fetcher.submit(
      {
        intent,
        answers: JSON.stringify(answers),
        selectedDomainIds: JSON.stringify(selectedDomainIds),
      },
      { method: "post" },
    );
  }

  // Surface server-side validation errors.
  if (fetcher.data && "error" in fetcher.data && fetcher.data.error && error !== fetcher.data.error) {
    setError(fetcher.data.error as string);
  }
  if (submitted) {
    return <SubmittedView submittedBody={submittedBody} />;
  }

  function toggleDomain(id: string) {
    setSelectedDomainIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  }

  // The domain picker only lives on its own first page for target-domains
  // cycles; single-core-domain cycles skip it entirely.
  const domainPageOffset = showDomainPicker ? 1 : 0;

  return (
    <div className="space-y-8">
      {showDomainPicker && (
        <section className={pager.index === 0 ? undefined : "hidden"}>
          <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
            Target domains
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            {domainSectionHint ?? "Pick the domain(s) you'd like to be considered for. You can pick more than one."}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {cycle.targetDomains.map((d) => {
              const checked = selectedDomainIds.includes(d.id);
              return (
                <Checkbox
                  key={d.id}
                  checked={checked}
                  onChange={() => toggleDomain(d.id)}
                  label={<span className="text-sm font-medium text-dark-blue">{d.displayName}</span>}
                  className={`px-4 py-3 rounded-lg border transition ${
                    checked
                      ? "border-accent-coral bg-accent-coral/10"
                      : "border-border hover:border-accent-coral/50"
                  }`}
                />
              );
            })}
          </div>
        </section>
      )}

      <section className={showDomainPicker && pager.index === 0 ? "hidden" : undefined}>
        <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
          Questions
        </h2>
        <div className="space-y-5">
          <FormPageHeading page={pager.page} />
          <FormFieldList
            questions={pager.page.questions}
            labelClassName="font-semibold"
            values={answers}
            onChange={(key, v) => setAnswers((prev) => ({ ...prev, [key]: v }))}
          />
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {justSaved && !error && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Draft saved.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!pager.isFirst && (
          <button
            type="button"
            onClick={pager.goBack}
            disabled={busy}
            className="px-5 py-2 rounded-full border-2 border-border text-sm font-semibold text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition disabled:opacity-50"
          >
            Back
          </button>
        )}
        {pager.multi && (
          <span className="text-xs text-muted-foreground">
            Step {pager.index + 1 + domainPageOffset} of {pager.pages.length + domainPageOffset}
          </span>
        )}
        <button
          type="button"
          onClick={() => submitForm("save-draft")}
          disabled={busy}
          className="px-5 py-2 rounded-full border-2 border-border text-sm font-semibold text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition disabled:opacity-50"
        >
          {busy && fetcher.formData?.get("intent") === "save-draft" ? "Saving…" : "Save draft"}
        </button>
        {pager.isLast ? (
          <button
            type="button"
            onClick={() => submitForm("submit")}
            disabled={busy}
            className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
          >
            {busy && fetcher.formData?.get("intent") === "submit" ? "Submitting…" : "Submit"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              const missing = pager.goNext((q) => answers[q.key]);
              if (missing) setError(`"${missing.data.label}" is required.`);
              else setError(null);
            }}
            className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}

function SubmittedView({ submittedBody }: { submittedBody: string }) {
  const fetcher = useFetcher();
  const [confirming, setConfirming] = useState(false);
  const busy = fetcher.state !== "idle";
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-green-200 bg-green-50/50 px-6 py-8 text-center">
        <h2 className="font-heading text-xl font-bold text-dark-blue mb-2">Submitted</h2>
        <p className="text-sm text-muted-foreground">{submittedBody}</p>
      </div>
      <div className="flex justify-end">
        {confirming ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 space-y-2">
            <p className="text-sm font-semibold text-red-700">Withdraw this application?</p>
            <p className="text-xs text-red-600/80">You can't reopen it without contacting the hiring lead.</p>
            <div className="flex gap-3">
              <button
                onClick={() => fetcher.submit({ intent: "withdraw" }, { method: "post" })}
                disabled={busy}
                className="px-4 py-1.5 rounded-full bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy ? "Withdrawing…" : "Yes, withdraw"}
              </button>
              <button onClick={() => setConfirming(false)} className="text-sm text-muted-foreground hover:underline">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="text-sm text-muted-foreground hover:text-red-600 hover:underline"
          >
            Withdraw application
          </button>
        )}
      </div>
    </div>
  );
}
