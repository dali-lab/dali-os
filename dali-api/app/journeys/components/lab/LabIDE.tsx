import { useState } from "react";
import { ArrowLeft, BookOpenCheck, Check, FolderTree, RotateCcw } from "lucide-react";
import type { Lab } from "~/journeys/lib/types";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { useMediaQuery } from "~/hooks/useIsMobile";
import { cn } from "~/lib/cn";
import { useLab } from "./useLab";
import { FileTree } from "./FileTree";
import { EditorPane } from "./EditorPane";
import { LabGuide } from "./LabGuide";
import { LabPreview } from "./LabPreview";
import { LabConsole } from "./LabConsole";
import { LabCheckFrame } from "./LabCheckFrame";
import { Splitter } from "./Splitter";

type SidePanel = "guide" | "files";

const SIDE_ITEMS = [
  { id: "guide", label: "Guide", icon: BookOpenCheck },
  { id: "files", label: "Files", icon: FolderTree },
] as const;

export interface LabIDEProps {
  lab: Lab;
  title: string;
  subtitle?: string;
  isCompleted: boolean;
  onComplete: () => void;
  onExit: () => void;
  exitLabel: string;
  completeLabel?: string;
}

export function LabIDE({
  lab,
  title,
  subtitle,
  isCompleted,
  onComplete,
  onExit,
  exitLabel,
  completeLabel = "Complete module",
}: LabIDEProps) {
  const state = useLab(lab);
  const { runtime, tabs } = state;
  const dialog = useDialog();
  const [side, setSide] = useState<SidePanel | null>("guide");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const dir = isDesktop ? "horizontal" : "vertical";
  const keySuffix = isDesktop ? "h" : "v";

  const passed = lab.steps.filter((s) => runtime.results[s.id]).length;
  const allPassed = passed === lab.steps.length;

  const confirmReset = async () => {
    const ok = await dialog.confirm({
      title: "Reset the lab?",
      description: "Your changes are replaced with the starter files.",
      confirmLabel: "Reset",
      tone: "destructive",
    });
    if (ok) state.reset();
  };

  const editor = (
    <EditorPane
      files={state.files}
      tabs={tabs.openTabs}
      activePath={tabs.activePath}
      onSelect={tabs.open}
      onClose={tabs.close}
      onChange={state.updateFile}
    />
  );

  const output = (
    <Splitter
      direction="vertical"
      storageKey="lab-ide-output"
      defaultSize={68}
      minFirst={20}
      minSecond={10}
      className="h-full"
      first={<LabPreview doc={runtime.previewDoc} onRefresh={runtime.rerun} frameRef={runtime.previewRef} />}
      second={<LabConsole logs={runtime.logs} onClear={runtime.clearLogs} />}
    />
  );

  const work = (
    <Splitter
      direction={dir}
      storageKey={`lab-ide-work-${keySuffix}`}
      defaultSize={isDesktop ? 58 : 55}
      minFirst={25}
      minSecond={20}
      className="h-full"
      first={editor}
      second={output}
    />
  );

  return (
    <div className="flex h-full flex-col bg-os-bg text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-os-container px-3">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onExit} className={buttonClasses("ghost", "sm")}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {exitLabel}
          </button>
          <span className="h-5 w-px bg-os-container" aria-hidden />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            {subtitle && <p className="truncate text-xs text-os-muted">{subtitle}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex" aria-live="polite">
            <span className="flex gap-1" aria-hidden>
              {lab.steps.map((s) => (
                <span
                  key={s.id}
                  className={cn("h-1.5 w-5 rounded-full", runtime.results[s.id] ? "bg-os-green" : "bg-os-container")}
                />
              ))}
            </span>
            <span className="text-xs tabular-nums text-os-grey">
              {passed}/{lab.steps.length} checks
            </span>
          </div>
          <button type="button" onClick={() => void confirmReset()} className={buttonClasses("ghost", "sm")}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </button>
          {isCompleted ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-os-green/15 px-3 text-sm font-medium text-os-green">
              <Check className="h-3.5 w-3.5" aria-hidden />
              Completed
            </span>
          ) : (
            <button
              type="button"
              disabled={!allPassed}
              onClick={onComplete}
              title={allPassed ? undefined : "Pass every check to finish"}
              className={buttonClasses("primary", "sm")}
            >
              {completeLabel}
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Lab panels"
          className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-os-container bg-os-nav py-2"
        >
          {SIDE_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={side === id}
              title={label}
              onClick={() => setSide(side === id ? null : id)}
              className={cn(
                "grid h-10 w-10 place-items-center rounded-os-item transition-colors",
                side === id ? "bg-os-container text-foreground" : "text-os-muted hover:text-foreground",
              )}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </button>
          ))}
        </nav>

        <div className="min-h-0 min-w-0 flex-1">
          {side ? (
            <Splitter
              direction={dir}
              storageKey={`lab-ide-side-${keySuffix}`}
              defaultSize={isDesktop ? 22 : 30}
              minFirst={14}
              minSecond={40}
              className="h-full"
              first={
                <div className="h-full bg-os-bg">
                  {side === "guide" ? (
                    <LabGuide lab={lab} results={runtime.results} checking={runtime.checking} />
                  ) : (
                    <FileTree
                      files={state.files}
                      activePath={tabs.activePath}
                      onOpen={tabs.open}
                      onCreate={state.createFile}
                      onDelete={state.deletePath}
                      onRename={state.movePath}
                    />
                  )}
                </div>
              }
              second={work}
            />
          ) : (
            work
          )}
        </div>
      </div>

      <LabCheckFrame doc={runtime.testDoc} frameRef={runtime.checkRef} />
    </div>
  );
}
