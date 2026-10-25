import { FileCode2 } from "lucide-react";
import type { LabFiles } from "~/journeys/lib/types";
import { CodeEditor } from "./CodeEditor";
import { EditorTabs } from "./EditorTabs";

export function EditorPane({
  files,
  tabs,
  activePath,
  onSelect,
  onClose,
  onChange,
}: {
  files: LabFiles;
  tabs: string[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, value: string) => void;
}) {
  return (
    <section aria-label="Code editor" className="flex h-full min-w-0 flex-col bg-os-well">
      {tabs.length > 0 && <EditorTabs tabs={tabs} activePath={activePath} onSelect={onSelect} onClose={onClose} />}
      {activePath ? (
        <>
          <p className="shrink-0 truncate border-b border-os-container/60 px-4 py-1.5 font-mono text-[11px] text-os-muted">
            {activePath}
          </p>
          <div className="min-h-0 flex-1">
            <CodeEditor
              key={activePath}
              path={activePath}
              value={files[activePath] ?? ""}
              onChange={(v) => onChange(activePath, v)}
            />
          </div>
        </>
      ) : (
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div>
            <FileCode2 className="mx-auto h-8 w-8 text-os-muted" aria-hidden />
            <p className="mt-3 text-sm text-os-grey">Open a file from the explorer to start editing.</p>
          </div>
        </div>
      )}
    </section>
  );
}
