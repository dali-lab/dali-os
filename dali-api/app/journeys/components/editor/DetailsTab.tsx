import { Trash2, X } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { IconButton } from "~/components/ui/IconButton";
import { Select } from "~/components/ui/floating";
import { moduleTitle } from "~/journeys/lib/journey";
import { addDependency, canAddDependency, removeDependency, removeModule, updateModule } from "~/journeys/lib/journey-edit";
import type { Journey, JourneyModule } from "~/journeys/lib/types";
import { FormField } from "~/components/ui/FormField";

export function DetailsTab({
  journey,
  module: mod,
  onChange,
  onDeleted,
}: {
  journey: Journey;
  module: JourneyModule;
  onChange: (fn: (j: Journey) => Journey) => void;
  onDeleted: () => void;
}) {
  const dialog = useDialog();
  const update = (patch: Partial<JourneyModule>) => onChange((d) => updateModule(d, mod.id, (m) => ({ ...m, ...patch })));
  const prerequisites = mod.dependsOn
    .map((id) => journey.modules.find((m) => m.id === id))
    .filter((m): m is JourneyModule => Boolean(m));
  const candidates = journey.modules.filter((m) => canAddDependency(journey, mod.id, m.id));
  const unlocks = journey.modules.filter((m) => m.dependsOn.includes(mod.id));

  const handleDelete = async () => {
    const ok = await dialog.confirm({
      title: `Delete ${moduleTitle(mod)}?`,
      description: "Its pages, slides, lab and quiz go with it. Modules that built on it lose that prerequisite.",
      confirmLabel: "Delete module",
      tone: "destructive",
    });
    if (!ok) return;
    onChange((d) => removeModule(d, mod.id));
    onDeleted();
  };

  return (
    <div className="space-y-5">
      <FormField label="Title" value={mod.title} onChange={(title) => update({ title })} />
      <FormField
        label="Summary"
        multiline
        rows={3}
        value={mod.summary}
        placeholder="One or two sentences learners see on the map"
        onChange={(summary) => update({ summary })}
      />
      <FormField label="Estimated time" value={mod.duration} placeholder="20 min" onChange={(duration) => update({ duration })} />

      <section className="border-t border-os-container pt-5">
        <h4 className="os-field-label">Prerequisites</h4>
        {prerequisites.length === 0 ? (
          <p className="mt-2 text-sm text-os-muted">None. Learners can start here.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {prerequisites.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded-os-item bg-os-well py-1.5 pl-3 pr-1.5 text-sm">
                <span className="truncate">{moduleTitle(p)}</span>
                <IconButton
                  label={`Remove ${moduleTitle(p)} as a prerequisite`}
                  icon={X}
                  onClick={() => onChange((d) => removeDependency(d, mod.id, p.id))}
                />
              </li>
            ))}
          </ul>
        )}
        {candidates.length > 0 && (
          <div className="mt-2">
          <Select
            ariaLabel="Add a prerequisite"
            placeholder="Add a prerequisite"
            value=""
            options={candidates.map((c) => ({ value: c.id, label: moduleTitle(c) }))}
            onChange={(prereq: string) => prereq && onChange((d) => addDependency(d, mod.id, prereq))}
          />
          </div>
        )}
        {unlocks.length > 0 && <p className="mt-3 text-xs text-os-muted">Unlocks: {unlocks.map(moduleTitle).join(", ")}</p>}
      </section>

      <section className="border-t border-os-container pt-5">
        <button type="button" onClick={handleDelete} className={buttonClasses("ghost", "sm", "hover:text-destructive")}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Delete module
        </button>
      </section>
    </div>
  );
}
