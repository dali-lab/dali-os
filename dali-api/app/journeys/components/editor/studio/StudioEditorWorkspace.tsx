import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { DocEditor } from "~/components/doc";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { FormField } from "~/components/ui/FormField";
import { LESSON_FEATURES } from "~/journeys/lib/doc-features";
import { moveItem } from "~/journeys/lib/journey-edit";
import { createCriterion, evaluateRule, initialWork, KIND_LABELS, MODE_LABELS } from "~/journeys/lib/studio";
import type { CanvasItem, CheckMode, Criterion, Hotspot, StudioLab } from "~/journeys/lib/studio-types";
import type { RichDoc } from "~/journeys/lib/types";
import { CanvasBoard } from "~/journeys/components/studio/canvas/CanvasBoard";
import { CriterionEditor } from "./CriterionEditor";

type Tab = "rubric" | "brief";

const MODES: CheckMode[] = ["auto", "self", "mentor"];

/** The starter board or document template on the left, the rubric and brief on the right. */
export function StudioEditorWorkspace({ studio, onChange }: { studio: StudioLab; onChange: (fn: (s: StudioLab) => StudioLab) => void }) {
  const dialog = useDialog();
  const [tab, setTab] = useState<Tab>("rubric");
  const hotspots = studio.canvas?.hotspots ?? [];
  const starter = useMemo(() => initialWork(studio), [studio]);

  const setCriteria = (fn: (cs: Criterion[]) => Criterion[]) => onChange((s) => ({ ...s, criteria: fn(s.criteria) }));
  const setItems = (fn: (items: CanvasItem[]) => CanvasItem[]) =>
    onChange((s) => ({ ...s, canvas: { items: fn(s.canvas?.items ?? []), hotspots: s.canvas?.hotspots ?? [] } }));
  const setHotspots = (fn: (hs: Hotspot[]) => Hotspot[]) =>
    onChange((s) => ({ ...s, canvas: { items: s.canvas?.items ?? [], hotspots: fn(s.canvas?.hotspots ?? []) } }));

  const counts = studio.criteria.reduce<Record<CheckMode, number>>((acc, c) => ({ ...acc, [c.mode]: acc[c.mode] + 1 }), {
    auto: 0,
    self: 0,
    mentor: 0,
  });

  const removeCriterion = async (c: Criterion, n: number) => {
    const ok = await dialog.confirm({
      title: `Delete criterion ${n}?`,
      description: c.label.trim() || undefined,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) setCriteria((cs) => cs.filter((x) => x.id !== c.id));
  };

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <section aria-label={studio.kind === "canvas" ? "Starter board" : "Document template"} className="relative min-h-[420px] min-w-0 flex-1">
        {studio.kind === "canvas" ? (
          <>
            <CanvasBoard
              mode="editor"
              items={studio.canvas?.items ?? []}
              onItemsChange={setItems}
              hotspots={hotspots}
              onHotspotsChange={setHotspots}
              showHotspots
            />
            <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-xs rounded-os-item bg-os-card/95 p-3 text-xs leading-5 text-os-grey shadow-lg">
              <p className="font-medium text-foreground">Starter board</p>
              <p className="mt-0.5">Every learner starts with a copy of this. Hidden areas never show to learners; use them for "find the problems" checks.</p>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 overflow-y-auto">
            <div className="max-w-3xl px-6 pb-24 pt-6 lg:px-12">
              <p className="text-xs text-os-muted">Template. Every learner starts with this document.</p>
              <DocEditor
                features={LESSON_FEATURES}
                placeholder="Add the headings and prompts learners should fill in"
                initialContent={studio.document?.template ?? []}
                onChange={(blocks) => onChange((s) => ({ ...s, document: { template: blocks as RichDoc } }))}
              />
            </div>
          </div>
        )}
      </section>

      <aside
        aria-label="Lab settings"
        className="os-form flex max-h-[60vh] shrink-0 flex-col border-t border-os-container bg-os-bg lg:max-h-none lg:w-[440px] lg:border-l lg:border-t-0"
      >
        <div className="shrink-0 border-b border-os-container px-5 py-3">
          <SegmentedTabButtons
            size="sm"
            label="Settings"
            items={[
              { label: `Rubric · ${studio.criteria.length}`, active: tab === "rubric", onClick: () => setTab("rubric") },
              { label: "Brief", active: tab === "brief", onClick: () => setTab("brief") },
            ]}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10">
          {tab === "brief" ? (
            <div className="space-y-5 pt-5">
              <p className="text-xs text-os-muted">{KIND_LABELS[studio.kind]} lab</p>
              <FormField label="Title" value={studio.title} onChange={(title) => onChange((s) => ({ ...s, title }))} />
              <FormField
                label="Brief"
                multiline
                rows={12}
                value={studio.brief}
                placeholder="Set the scene and say what the learner should make."
                hint="Leave a blank line between paragraphs."
                onChange={(brief) => onChange((s) => ({ ...s, brief }))}
              />
            </div>
          ) : (
            <div className="pt-5">
              <p className="text-sm leading-6 text-os-grey">
                Learners see these as a checklist. Automatic checks run as they work, self-checks are ticked by the learner, and mentor
                reviews are approved by an editor of this journey.
              </p>
              <p className="mt-3 text-xs text-os-muted">
                {counts.auto} automatic · {counts.self} self-check · {counts.mentor} mentor
                {counts.mentor === 0 && " · learners can finish without a review"}
              </p>

              {studio.criteria.length === 0 ? (
                <p className="mt-6 text-sm text-os-muted">No criteria yet. Learners need at least one.</p>
              ) : (
                <ol className="mt-2 divide-y divide-os-container">
                  {studio.criteria.map((c, i) => (
                    <CriterionEditor
                      key={c.id}
                      criterion={c}
                      index={i}
                      total={studio.criteria.length}
                      studioKind={studio.kind}
                      hotspotCount={hotspots.length}
                      passesOnStarter={c.mode === "auto" && Boolean(c.rule) && evaluateRule(c.rule!, studio, starter).passed}
                      onChange={(next) => setCriteria((cs) => cs.map((x) => (x.id === c.id ? next : x)))}
                      onMove={(delta) => setCriteria((cs) => moveItem(cs, i, delta))}
                      onDelete={() => removeCriterion(c, i + 1)}
                    />
                  ))}
                </ol>
              )}

              <div className="mt-2 border-t border-os-container pt-4">
                <p className="os-field-label">Add criterion</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setCriteria((cs) => [...cs, createCriterion(mode, studio.kind)])}
                      className={buttonClasses("secondary", "sm")}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      {MODE_LABELS[mode]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
