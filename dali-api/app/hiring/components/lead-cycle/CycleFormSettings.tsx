import { useState } from "react";
import { Form, Link, useFetcher } from "react-router";
import { Select, type SelectOption } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";
import { Plus } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { DomainSubRow, SubRowEmpty, SubRowVersion } from "~/hiring/components/cycle-setup/DomainSubRow";
import { Pill } from "~/components/ui/Pill";
import { SetupCard, rowTrigger } from "~/hiring/components/cycle-setup/SetupCard";
import { formatVersionLabel } from "~/lib/formatVersion";

export function BlindReviewToggle({ anonymizeReview }: { anonymizeReview: boolean }) {
  return (
    <SetupCard
      title="Blind review"
    >
      <Form method="post" preventScrollReset>
        <input type="hidden" name="intent" value="set-anonymize-review" />
        <Toggle
          name="anonymizeReview"
          tone="os"
          defaultChecked={anonymizeReview}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-full rounded-os-item bg-os-well px-4 py-3"
          label={anonymizeReview ? "On" : "Off"}
          description={anonymizeReview ? "Everyone sees “Applicant N” until their domain releases interviews or closes its first delib." : "Everyone sees real names."}
        />
      </Form>
    </SetupCard>
  );
}

// A form bound to the cycle itself (the general application, the continued
// interest form): what's bound, Create when nothing is, and a swap while the
// cycle allows one.
export function CycleFormRow({
  form,
  allForms,
  swappable,
  createIntent,
  setIntent,
  ariaLabel,
}: {
  form: { id: string; name: string } | null;
  allForms: { id: string; name: string }[];
  swappable: boolean;
  createIntent: string;
  setIntent: string;
  ariaLabel: string;
}) {
  const os = useOsChrome();
  const formFetcher = useFetcher();
  const formBusy = formFetcher.state !== "idle";
  const [pickingForm, setPickingForm] = useState(false);
  const small = buttonClasses("secondary", "sm");

  return (
    <DomainSubRow
      label="Form"
      value={
        form ? (
          <Link to={`/forms/edit/${form.id}`} className="min-w-0 max-w-full truncate text-os-accent hover:underline" title={form.name}>
            {form.name}
          </Link>
        ) : (
          <SubRowEmpty>None yet</SubRowEmpty>
        )
      }
      action={
        !pickingForm && (
          <>
            {!form && (
              <button
                type="button"
                disabled={formBusy}
                onClick={() => formFetcher.submit({ intent: createIntent }, { method: "post" })}
                className={small}
              >
                <Plus className="w-3.5 h-3.5" aria-hidden /> {formBusy ? "Creating…" : "Create form"}
              </button>
            )}
            {swappable && allForms.length > 0 && (
              <button type="button" onClick={() => setPickingForm(true)} className={small}>
                Use a different form
              </button>
            )}
          </>
        )
      }
      editor={
        swappable &&
        pickingForm && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[14rem] flex-1">
              <Select
                ariaLabel={ariaLabel}
                defaultValue={form?.id ?? ""}
                placeholder="Pick a form"
                onChange={(id) => {
                  setPickingForm(false);
                  if (!id || id === form?.id) return;
                  formFetcher.submit({ intent: setIntent, formId: id }, { method: "post" });
                }}
                options={allForms.map((f) => ({ value: f.id, label: f.name }))}
                buttonClassName={rowTrigger(os.formTrigger)}
              />
            </div>
            <button type="button" onClick={() => setPickingForm(false)} className={small}>
              Cancel
            </button>
          </div>
        )
      }
    />
  );
}

// The general application: the form every applicant fills and the rubric
// every application is scored on, as two rows shaped like a domain row (label,
// what's bound, then small actions).
export function GeneralApplicationSection({
  cycleStatus,
  applicationForm,
  allForms,
  currentRubricVersionId,
  rubricVersionOptions,
  rubricLocked,
}: {
  cycleStatus: string;
  applicationForm: { id: string; name: string } | null;
  allForms: { id: string; name: string }[];
  currentRubricVersionId: string | null;
  rubricVersionOptions: any[];
  rubricLocked: boolean;
}) {
  const os = useOsChrome();
  // Opens on demand only: an auto-open editor under an empty value repeated
  // "Rubric" / "No rubric" twice.
  const [editingRubric, setEditingRubric] = useState(false);

  const rubricVersion = (rv: any) => ({
    name: rv.rubric?.name ?? "Rubric",
    versionNumber: rv.versionNumber,
    createdAt: rv.createdAt,
    createdBy: rv.createdBy,
  });
  const currentRubric = rubricVersionOptions.find((rv: any) => rv.id === currentRubricVersionId);
  const small = buttonClasses("secondary", "sm");

  return (
    <SetupCard title="General application">
      {/* Same line anatomy as a domain's Challenge and Rubric lines. */}
      <div className="flex flex-col gap-3 rounded-os-item bg-os-well p-4">
        <CycleFormRow
          form={applicationForm}
          allForms={allForms}
          swappable={cycleStatus === "Draft"}
          createIntent="create-application-form"
          setIntent="set-application-form"
          ariaLabel="Application form"
        />
        <DomainSubRow
          label="Rubric"
          value={
            currentRubric ? (
              <SubRowVersion version={rubricVersion(currentRubric)} />
            ) : (
              <SubRowEmpty>None yet</SubRowEmpty>
            )
          }
          action={
            rubricLocked ? (
              <Pill>Locked, reviews started</Pill>
            ) : (
              !editingRubric && (
                <button type="button" onClick={() => setEditingRubric(true)} className={small}>
                  {currentRubric ? "Change" : "Set rubric"}
                </button>
              )
            )
          }
          editor={
            !rubricLocked &&
            editingRubric && (
              <Form
                method="post"
                preventScrollReset
                className="flex flex-wrap items-center gap-2"
                onSubmit={() => setEditingRubric(false)}
              >
                <input type="hidden" name="intent" value="set-general-rubric" />
                <div className="min-w-[14rem] flex-1">
                  <Select
                    name="rubricVersionId"
                    ariaLabel="General application rubric"
                    defaultValue={currentRubricVersionId ?? ""}
                    placeholder="Pick a rubric"
                    options={[
                      { value: "", label: "No rubric" },
                      ...rubricVersionOptions.map((rv: any): SelectOption => ({ value: rv.id, label: formatVersionLabel(rubricVersion(rv)) })),
                    ]}
                    buttonClassName={rowTrigger(os.formTrigger)}
                  />
                </div>
                <button type="submit" className={buttonClasses("primary", "sm")}>
                  Save
                </button>
                <button type="button" onClick={() => setEditingRubric(false)} className={small}>
                  Cancel
                </button>
              </Form>
            )
          }
        />
      </div>
    </SetupCard>
  );
}
