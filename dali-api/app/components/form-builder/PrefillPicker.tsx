import { Select, type SelectOption } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import {
  PREFILL_FIELDS,
  fillersNoun,
  isPrefillFieldKey,
  prefillFieldsFor,
  prefillReach,
  type FillerKind,
} from "~/forms/lib/prefill-fields";
import type { Question } from "~/types";

const NONE = "";

export function PrefillPicker({
  question,
  fillers,
  onChange,
}: {
  question: Pick<Question, "type" | "data">;
  fillers: FillerKind[];
  onChange: (prefill: string | undefined) => void;
}) {
  const { formTrigger } = useOsChrome();
  const fits = prefillFieldsFor(question);
  if (fits.length === 0) return null;

  const stored = question.data.prefill;
  const current = isPrefillFieldKey(stored) && fits.includes(stored) ? stored : undefined;
  const currentReach = current ? prefillReach(current, fillers) : null;

  const options: SelectOption[] = [
    { value: NONE, label: "Nothing, start blank" },
    ...fits.flatMap((key) => {
      const reach = prefillReach(key, fillers);
      if (reach.reach === "none" && key !== current) return [];
      return [
        {
          value: key,
          label: PREFILL_FIELDS[key].label,
          description:
            reach.reach === "some"
              ? `Blank for ${reach.blankFor}.`
              : reach.reach === "none"
                ? "Never fills in with this form's sharing."
                : undefined,
        },
      ];
    }),
  ];

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-foreground/80">Fill in from</label>
      <Select
        value={current ?? NONE}
        onChange={(v) => onChange(v === NONE ? undefined : v)}
        options={options}
        buttonClassName={formTrigger}
      />
      {currentReach?.reach === "none" ? (
        <p className="text-xs text-os-amber">
          This never fills in: the form is shared with {fillersNoun(fillers)} only.
        </p>
      ) : currentReach?.reach === "some" ? (
        <p className="text-xs text-muted-foreground">
          Fills in from their records. Blank for {currentReach.blankFor}. They can change it either way.
        </p>
      ) : current ? (
        <p className="text-xs text-muted-foreground">Fills in from their records. They can change it.</p>
      ) : null}
    </div>
  );
}
