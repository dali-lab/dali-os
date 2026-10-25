import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { IconButton } from "~/components/ui/IconButton";
import { moduleTitle } from "~/journeys/lib/journey";
import { updateModule } from "~/journeys/lib/journey-edit";
import type { JourneyIssue } from "~/journeys/lib/journey-validation";
import type { Journey, JourneyModule } from "~/journeys/lib/types";
import { DetailsTab } from "./DetailsTab";
import { LabTab } from "./LabTab";
import { PagesTab } from "./PagesTab";
import { QuizTab } from "./QuizTab";
import { SlidesTab } from "./SlidesTab";

type Tab = "details" | "pages" | "slides" | "lab" | "quiz";

export function ModuleEditorPanel({
  journey,
  module: mod,
  issues,
  onChange,
  onClose,
}: {
  journey: Journey;
  module: JourneyModule;
  issues: JourneyIssue[];
  onChange: (fn: (j: Journey) => Journey) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("details");
  const updateMod = (fn: (m: JourneyModule) => JourneyModule) => onChange((d) => updateModule(d, mod.id, fn));
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "details", label: "Details" },
    { id: "pages", label: "Pages", count: mod.pages.length },
    { id: "slides", label: "Slides", count: mod.slides?.length || undefined },
    { id: "lab", label: "Lab", count: mod.lab?.steps.length ?? mod.studio?.criteria.length },
    { id: "quiz", label: "Quiz", count: mod.quiz?.questions.length },
  ];

  return (
    <>
      <div className="shrink-0 border-b border-os-container px-6 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-os-muted">Editing module</p>
            <h2 className="mt-0.5 truncate font-heading text-lg font-semibold">{moduleTitle(mod)}</h2>
          </div>
          <IconButton label="Close module editor" icon={X} onClick={onClose} />
        </div>
        <SegmentedTabButtons
          className="mt-4"
          size="sm"
          stretch
          label="Module sections"
          items={tabs.map((t) => ({ label: t.label, count: t.count, active: tab === t.id, onClick: () => setTab(t.id) }))}
        />
      </div>

      <div className="os-form min-h-0 flex-1 overflow-y-auto p-6">
        {issues.length > 0 && (
          <div className="mb-5 rounded-os-item bg-os-amber/10 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-medium text-os-amber">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Fix before publishing
            </p>
            <ul className="mt-1.5 space-y-0.5 pl-6 text-sm text-foreground/85">
              {issues.map((issue) => (
                <li key={issue.message}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}
        {tab === "details" && <DetailsTab journey={journey} module={mod} onChange={onChange} onDeleted={onClose} />}
        {tab === "pages" && <PagesTab module={mod} onChange={updateMod} />}
        {tab === "slides" && <SlidesTab module={mod} onChange={updateMod} />}
        {tab === "lab" && <LabTab module={mod} onChange={updateMod} />}
        {tab === "quiz" && <QuizTab module={mod} onChange={updateMod} />}
      </div>
    </>
  );
}
