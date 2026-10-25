import type { ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, Trash2 } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { Segmented } from "~/components/ui/Segmented";
import { Select } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { defaultRule, describeRule, ITEM_TYPE_LABELS, MODE_LABELS, RULE_KINDS_FOR, STICKY_COLORS } from "~/journeys/lib/studio";
import type { AutoRule, AutoRuleKind, CanvasItemType, CheckMode, Criterion, StickyColor, StudioKind } from "~/journeys/lib/studio-types";

const captionClass = "text-xs text-os-grey flex flex-col gap-1";

function NumberField({ label, value, onChange, min = 1 }: { label: string; value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <label className={captionClass}>
      {label}
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.round(Number(e.target.value)) || min))}
        className="w-full tabular-nums"
      />
    </label>
  );
}

function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <label className={captionClass}>
      {label}
      <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="w-full" />
    </label>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={captionClass}>
      <span>{label}</span>
      {children}
    </div>
  );
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

function RuleFields({ rule, hotspotCount, onChange }: { rule: AutoRule; hotspotCount: number; onChange: (r: AutoRule) => void }) {
  switch (rule.kind) {
    case "item-count":
      return (
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="At least" value={rule.min} onChange={(min) => onChange({ ...rule, min })} />
          <Labelled label="Of">
            <Select
              ariaLabel="Item type"
              value={rule.itemType}
              options={(Object.keys(ITEM_TYPE_LABELS) as (CanvasItemType | "any")[]).map((t) => ({ value: t, label: ITEM_TYPE_LABELS[t] }))}
              onChange={(itemType) => onChange({ ...rule, itemType, color: itemType === "sticky" ? rule.color : undefined })}
            />
          </Labelled>
          {rule.itemType === "sticky" && (
            <Labelled label="Color">
              <Select
                ariaLabel="Sticky color"
                value={rule.color ?? "any"}
                options={[{ value: "any", label: "Any" }, ...(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => ({ value: c, label: capitalize(c) }))]}
                onChange={(c) => onChange({ ...rule, color: c === "any" ? undefined : (c as StickyColor) })}
              />
            </Labelled>
          )}
        </div>
      );
    case "hotspots":
      return (
        <div>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Find at least" value={rule.min} onChange={(min) => onChange({ ...rule, min })} />
          </div>
          <p className={cn("mt-1.5 text-xs", rule.min > hotspotCount ? "text-os-amber" : "text-os-muted")}>
            {hotspotCount === 0
              ? "Mark problem areas on the board with the target tool (H)."
              : `of ${hotspotCount} hidden ${hotspotCount === 1 ? "area" : "areas"} on the board`}
          </p>
        </div>
      );
    case "contains-text":
      return <TextField label="Phrase" value={rule.text} placeholder="e.g. acceptance criteria" onChange={(text) => onChange({ ...rule, text })} />;
    case "word-count":
      return (
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="Minimum words" value={rule.min} onChange={(min) => onChange({ ...rule, min })} />
        </div>
      );
    case "section":
      return (
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <TextField label="Heading contains" value={rule.heading} placeholder="e.g. Why" onChange={(heading) => onChange({ ...rule, heading })} />
          <NumberField label="Min words" value={rule.minWords} onChange={(minWords) => onChange({ ...rule, minWords })} />
        </div>
      );
    case "list-items":
      return (
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <TextField label="Heading contains" value={rule.heading} placeholder="e.g. Done when" onChange={(heading) => onChange({ ...rule, heading })} />
          <NumberField label="Min items" value={rule.min} onChange={(min) => onChange({ ...rule, min })} />
        </div>
      );
  }
}

/** One rubric line: what the learner sees, how it's checked, and the automatic rule if any. */
export function CriterionEditor({
  criterion,
  index,
  total,
  studioKind,
  hotspotCount,
  passesOnStarter,
  onChange,
  onMove,
  onDelete,
}: {
  criterion: Criterion;
  index: number;
  total: number;
  studioKind: StudioKind;
  hotspotCount: number;
  /** Whether this automatic check already passes before the learner does anything. */
  passesOnStarter: boolean;
  onChange: (c: Criterion) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  return (
    <li className="py-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs tabular-nums text-os-muted">Criterion {index + 1}</span>
        <div className="flex items-center">
          <IconButton label="Move up" icon={ArrowUp} disabled={index === 0} onClick={() => onMove(-1)} />
          <IconButton label="Move down" icon={ArrowDown} disabled={index === total - 1} onClick={() => onMove(1)} />
          <IconButton label="Delete criterion" icon={Trash2} tone="destructive" onClick={onDelete} />
        </div>
      </div>

      <input
        type="text"
        aria-label="What the learner sees"
        value={criterion.label}
        placeholder="What the learner needs to do"
        onChange={(e) => onChange({ ...criterion, label: e.target.value })}
        className="mt-2 w-full font-medium"
      />
      <input
        type="text"
        aria-label="Extra detail"
        value={criterion.description ?? ""}
        placeholder="Extra detail (optional)"
        onChange={(e) => onChange({ ...criterion, description: e.target.value || undefined })}
        className="mt-2 w-full"
      />

      <Segmented
        className="mt-3"
        fullWidth
        ariaLabel="How it's checked"
        value={criterion.mode}
        options={(Object.keys(MODE_LABELS) as CheckMode[]).map((m) => ({ value: m, label: MODE_LABELS[m] }))}
        onChange={(mode) =>
          onChange({
            ...criterion,
            mode,
            rule: mode === "auto" ? (criterion.rule ?? defaultRule(RULE_KINDS_FOR[studioKind][0].kind)) : undefined,
          })
        }
      />

      {criterion.mode === "auto" && criterion.rule && (
        <div className="mt-3 space-y-3 rounded-os-item bg-os-well p-3">
          <Labelled label="Check that">
            <Select
              ariaLabel="Check that"
              value={criterion.rule.kind}
              options={RULE_KINDS_FOR[studioKind].map((r) => ({ value: r.kind, label: r.label }))}
              onChange={(kind) => onChange({ ...criterion, rule: defaultRule(kind as AutoRuleKind) })}
            />
          </Labelled>
          <RuleFields rule={criterion.rule} hotspotCount={hotspotCount} onChange={(rule) => onChange({ ...criterion, rule })} />
          <p className={cn("flex items-start gap-1.5 text-xs leading-5", passesOnStarter ? "text-os-amber" : "text-os-muted")}>
            {passesOnStarter ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            {passesOnStarter ? "Already passes on the starter content, so learners get it for free." : describeRule(criterion.rule)}
          </p>
        </div>
      )}
      {criterion.mode === "self" && <p className="mt-2 text-xs text-os-muted">The learner ticks this off before submitting.</p>}
      {criterion.mode === "mentor" && (
        <p className="mt-2 text-xs text-os-muted">An editor of this journey ticks this off in Reviews. The module completes after approval.</p>
      )}
    </li>
  );
}
