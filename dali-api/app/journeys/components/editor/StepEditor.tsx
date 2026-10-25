import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { LabStep } from "~/journeys/lib/types";
import { IconButton } from "~/components/ui/IconButton";
import { Tooltip } from "~/components/ui/floating/Tooltip";
import { FormField } from "~/components/ui/FormField";

export function StepEditor({
  step,
  index,
  isLast,
  onChange,
  onMove,
  onRemove,
  passesWithStarter,
}: {
  step: LabStep;
  index: number;
  isLast: boolean;
  onChange: (step: LabStep) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  /** The check already passes against the starter files. */
  passesWithStarter?: boolean;
}) {
  return (
    <li className="rounded-os-item bg-os-well p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium tabular-nums text-os-grey">
          Step {index + 1}
          {passesWithStarter && step.check.trim() && (
            <Tooltip content="Learners won't need to change anything to pass it.">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-os-amber/15 px-2 py-0.5 font-normal text-os-amber">
                <span className="h-1.5 w-1.5 rounded-full bg-os-amber" aria-hidden />
                Already passes with starter code
              </span>
            </Tooltip>
          )}
        </span>
        <div className="flex">
          <IconButton label="Move step up" icon={ArrowUp} iconClassName="h-3.5 w-3.5" disabled={index === 0} onClick={() => onMove(-1)} />
          <IconButton label="Move step down" icon={ArrowDown} iconClassName="h-3.5 w-3.5" disabled={isLast} onClick={() => onMove(1)} />
          <IconButton label="Delete step" icon={Trash2} iconClassName="h-3.5 w-3.5" tone="destructive" onClick={onRemove} />
        </div>
      </div>
      <div className="space-y-3">
        <FormField label="Title" value={step.title} onChange={(title) => onChange({ ...step, title })} />
        <FormField
          label="Instructions"
          multiline
          rows={2}
          value={step.instructions}
          onChange={(instructions) => onChange({ ...step, instructions })}
        />
        <FormField label="Hint (optional)" value={step.hint ?? ""} onChange={(hint) => onChange({ ...step, hint: hint || undefined })} />
        <FormField
          label="Check"
          multiline
          mono
          rows={3}
          value={step.check}
          placeholder="document.querySelector('button')?.textContent.trim() === 'Say hi'"
          hint="A JavaScript expression run in the learner's page. Return true when the step is done."
          onChange={(check) => onChange({ ...step, check })}
        />
      </div>
    </li>
  );
}
