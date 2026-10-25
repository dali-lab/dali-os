import { useState } from "react";
import { Plus } from "lucide-react";
import type { Lab, LabStep } from "~/journeys/lib/types";
import { addFile, removePath, renamePath, renamePathIn } from "~/journeys/lib/file-tree";
import { createStep, moveItem } from "~/journeys/lib/journey-edit";
import { buttonClasses } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { useFileTabs } from "~/journeys/components/lab/useFileTabs";
import { useLabRuntime } from "~/journeys/components/lab/useLabRuntime";
import { FileTree } from "~/journeys/components/lab/FileTree";
import { EditorPane } from "~/journeys/components/lab/EditorPane";
import { LabPreview } from "~/journeys/components/lab/LabPreview";
import { LabConsole } from "~/journeys/components/lab/LabConsole";
import { LabCheckFrame } from "~/journeys/components/lab/LabCheckFrame";
import { Splitter } from "~/journeys/components/lab/Splitter";
import { FormField } from "~/components/ui/FormField";
import { StepEditor } from "../StepEditor";

type RightTab = "steps" | "preview";

export function LabEditorWorkspace({ lab, onChange }: { lab: Lab; onChange: (fn: (lab: Lab) => Lab) => void }) {
  const tabs = useFileTabs(lab.files, lab.defaultFile);
  const runtime = useLabRuntime(lab.files, lab.steps);
  const [rightTab, setRightTab] = useState<RightTab>("steps");
  const { fieldLabel } = useOsChrome();

  const setSteps = (fn: (steps: LabStep[]) => LabStep[]) => onChange((l) => ({ ...l, steps: fn(l.steps) }));
  const paths = Object.keys(lab.files).sort();
  const startFile = lab.defaultFile && lab.defaultFile in lab.files ? lab.defaultFile : "";

  const files = (
    <div className="flex h-full flex-col bg-os-bg">
      <div className="min-h-0 flex-1">
        <FileTree
          files={lab.files}
          activePath={tabs.activePath}
          onOpen={tabs.open}
          onCreate={(path) => {
            onChange((l) => ({ ...l, files: addFile(l.files, path) }));
            tabs.open(path);
          }}
          onDelete={(path) => onChange((l) => ({ ...l, files: removePath(l.files, path) }))}
          onRename={(from, to) => {
            onChange((l) => ({
              ...l,
              files: renamePath(l.files, from, to),
              defaultFile: l.defaultFile ? renamePathIn(l.defaultFile, from, to) : l.defaultFile,
            }));
            tabs.rename(from, to);
          }}
        />
      </div>
      <div className="os-form shrink-0 border-t border-os-container p-3">
        <div className={fieldLabel}>
          <span className="os-field-label">Learners start in</span>
          <Select
            value={startFile}
            ariaLabel="Learners start in"
            options={[{ value: "", label: "index.html" }, ...paths.filter((p) => p !== "index.html").map((p) => ({ value: p, label: p }))]}
            onChange={(v) => onChange((l) => ({ ...l, defaultFile: v || undefined }))}
          />
        </div>
      </div>
    </div>
  );

  const editor = (
    <EditorPane
      files={lab.files}
      tabs={tabs.openTabs}
      activePath={tabs.activePath}
      onSelect={tabs.open}
      onClose={tabs.close}
      onChange={(path, value) => onChange((l) => ({ ...l, files: { ...l.files, [path]: value } }))}
    />
  );

  const settings = (
    <div className="flex h-full flex-col bg-os-bg">
      <div role="tablist" aria-label="Lab settings" className="flex h-10 shrink-0 gap-5 border-b border-os-container px-4">
        {(["steps", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={rightTab === t}
            onClick={() => setRightTab(t)}
            className={cn("relative text-sm transition-colors", rightTab === t ? "text-foreground" : "text-os-grey hover:text-foreground")}
          >
            {t === "steps" ? "Guide and steps" : "Preview"}
            {t === "steps" && <span className="ml-1.5 text-xs tabular-nums text-os-muted">{lab.steps.length}</span>}
            {rightTab === t && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-os-accent" aria-hidden />}
          </button>
        ))}
      </div>

      {rightTab === "steps" ? (
        <div className="os-form min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <FormField label="Lab title" value={lab.title} onChange={(title) => onChange((l) => ({ ...l, title }))} />
          <FormField
            label="Intro"
            multiline
            rows={3}
            value={lab.intro}
            hint="Shown at the top of the learner's guide. Wrap text in backticks for inline code."
            onChange={(intro) => onChange((l) => ({ ...l, intro }))}
          />
          <section>
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-os-grey">Guided steps</h4>
              <button type="button" onClick={() => setSteps((s) => [...s, createStep()])} className={buttonClasses("ghost", "xs")}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add step
              </button>
            </div>
            <p className="mt-1 text-xs text-os-muted">Checks run against the starter files as you edit them.</p>
            <ol className="mt-3 space-y-3">
              {lab.steps.map((step, i) => (
                <StepEditor
                  key={step.id}
                  step={step}
                  index={i}
                  isLast={i === lab.steps.length - 1}
                  passesWithStarter={!runtime.checking && Boolean(runtime.results[step.id])}
                  onChange={(next) => setSteps((s) => s.map((x) => (x.id === step.id ? next : x)))}
                  onMove={(delta) => setSteps((s) => moveItem(s, i, delta))}
                  onRemove={() => setSteps((s) => s.filter((x) => x.id !== step.id))}
                />
              ))}
            </ol>
          </section>
        </div>
      ) : (
        <Splitter
          direction="vertical"
          storageKey="lab-editor-output"
          defaultSize={70}
          minFirst={20}
          minSecond={10}
          className="min-h-0 flex-1"
          first={<LabPreview doc={runtime.previewDoc} onRefresh={runtime.rerun} frameRef={runtime.previewRef} />}
          second={<LabConsole logs={runtime.logs} onClear={runtime.clearLogs} />}
        />
      )}
    </div>
  );

  return (
    <div className="flex h-full">
      <Splitter
        direction="horizontal"
        storageKey="lab-editor-files"
        defaultSize={18}
        minFirst={12}
        minSecond={50}
        className="h-full min-w-0 flex-1"
        first={files}
        second={
          <Splitter
            direction="horizontal"
            storageKey="lab-editor-main"
            defaultSize={57}
            minFirst={30}
            minSecond={27}
            className="h-full"
            first={editor}
            second={settings}
          />
        }
      />
      <LabCheckFrame doc={runtime.testDoc} frameRef={runtime.checkRef} />
    </div>
  );
}
