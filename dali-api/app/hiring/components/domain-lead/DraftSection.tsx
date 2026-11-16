import { useState } from "react";
import { cn } from "~/lib/cn";
import { Form, useNavigation, useSubmit } from "react-router";
import { Plus } from "lucide-react";
import { HiringFormEmbed } from "~/hiring/components/HiringFormEmbed";
import { formatVersionLabel } from "~/lib/formatVersion";
import { Select, Tooltip } from "~/components/ui/floating";
import { buttonClasses } from "~/components/ui/Button";
import { useOsChrome } from "~/components/os-chrome";
import { Pill } from "~/components/ui/Pill";
import { rowTrigger } from "~/hiring/components/cycle-setup/SetupCard";
import { DomainSubRow, SubRowEmpty, SubRowVersion } from "~/hiring/components/cycle-setup/DomainSubRow";
import { ChallengeFormPicker } from "~/hiring/components/cycle-setup/ChallengeLine";
import type { DomainCycle, LinkedChallengeForm, RubricOption } from "~/hiring/components/domain-lead/table-shared";

export function DraftSection({ cycle, domainId, linkedChallengeForms, allForms, isChallengeReady }: {
  cycle: DomainCycle;
  domainId: string;
  linkedChallengeForms: LinkedChallengeForm[];
  allForms: { id: string; name: string }[];
  isChallengeReady: boolean;
}) {
  const { bodyText } = useOsChrome();
  const hasLinked = linkedChallengeForms.length > 0;
  const navigation = useNavigation();
  const submit = useSubmit();
  const [picking, setPicking] = useState(false);
  const linkedFormIds = new Set(linkedChallengeForms.map((cf) => cf.formId));
  const addChallenge = (formId?: string) => {
    setPicking(false);
    submit(
      { intent: "create-challenge-form", cycleId: cycle.id, domainId, ...(formId && { formId }) },
      { method: "post", preventScrollReset: true },
    );
  };
  // Creating a challenge form isn't idempotent (each submit makes a new
  // form), so the button is disabled while one is in flight.
  const creatingChallenge =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "create-challenge-form" &&
    navigation.formData?.get("domainId") === domainId;
  const hidden = (intent: string) => (
    <>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="cycleId" value={cycle.id} />
      <input type="hidden" name="domainId" value={domainId} />
    </>
  );

  // Ready: frozen for applicants, still reopenable with Edit challenges.
  if (hasLinked && isChallengeReady) {
    return (
      <>
        <div className="flex flex-col gap-3">
          {linkedChallengeForms.map((cf) => (
            <HiringFormEmbed key={cf.id} formId={cf.formId} name={cf.name} questions={cf.questions ?? []} />
          ))}
        </div>
        <Form method="post" preventScrollReset>
          {hidden("unmark-ready")}
          <button type="submit" className={buttonClasses("secondary", "md")}>
            Edit challenges
          </button>
        </Form>
      </>
    );
  }

  return (
    <>
      {hasLinked ? (
        <div className="flex flex-col gap-3">
          {linkedChallengeForms.map((cf) => (
            <HiringFormEmbed
              key={cf.id}
              formId={cf.formId}
              name={cf.name}
              questions={cf.questions ?? []}
              defaultOpen={linkedChallengeForms.length === 1}
              remove={{ intent: "remove-challenge-form", fields: { cdfId: cf.id } }}
            />
          ))}
        </div>
      ) : (
        <p className={cn(bodyText, "py-3 text-center")}>No challenge form yet. Add one to author it in Forms.</p>
      )}
      {picking && (
        <ChallengeFormPicker
          pickable={allForms.filter((f) => !linkedFormIds.has(f.id))}
          onAdd={addChallenge}
          onCancel={() => setPicking(false)}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!picking && (
          <button
            type="button"
            disabled={creatingChallenge}
            onClick={() => setPicking(true)}
            className={buttonClasses("secondary", "md")}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {creatingChallenge ? "Adding…" : "Add challenge form"}
          </button>
        )}
        {hasLinked && (
          <Form method="post" preventScrollReset>
            {hidden("mark-ready")}
            <Tooltip content="Tells the hiring lead this domain's challenge is set.">
              <button type="submit" className={buttonClasses("primary", "md")}>
                Mark as ready
              </button>
            </Tooltip>
          </Form>
        )}
      </div>
    </>
  );
}

export function RubricPicker({ cycleId, domainId, options, selectedId, locked }: {
  cycleId: string;
  domainId: string;
  options: RubricOption[];
  selectedId: string | null;
  locked: boolean;
}) {
  const { formTrigger } = useOsChrome();
  const version = (rv: RubricOption) => ({
    name: rv.rubric?.name ?? "Rubric",
    versionNumber: rv.versionNumber,
    createdAt: rv.createdAt,
    createdBy: rv.createdBy,
  });
  const selectedRv = options.find((rv: RubricOption) => rv.id === selectedId);
  if (locked) {
    return (
      <DomainSubRow
        label="Rubric"
        value={selectedRv ? <SubRowVersion version={version(selectedRv)} /> : <SubRowEmpty>None</SubRowEmpty>}
        action={<Pill>Locked</Pill>}
      />
    );
  }
  return (
    <Form method="post" preventScrollReset key={`rubric-${selectedId}`} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="intent" value="set-rubric" />
      <input type="hidden" name="cycleId" value={cycleId} />
      <input type="hidden" name="domainId" value={domainId} />
      <div className="min-w-0 flex-1">
        <Select
          name="rubricVersionId"
          ariaLabel="Rubric version"
          defaultValue={selectedId ?? ""}
          placeholder="No rubric"
          options={[{ value: "", label: "No rubric" }, ...options.map((rv: RubricOption) => ({ value: rv.id as string, label: formatVersionLabel(version(rv)) }))]}
          buttonClassName={rowTrigger(formTrigger)}
        />
      </div>
      <button type="submit" className={buttonClasses("primary", "md")}>
        Save
      </button>
    </Form>
  );
}
