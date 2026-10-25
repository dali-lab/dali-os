import { Ban } from "lucide-react";
import type { ConsoleEntry } from "~/journeys/lib/types";
import { cn } from "~/lib/cn";

const LEVEL_STYLES: Record<ConsoleEntry["level"], string> = {
  log: "text-foreground/85",
  info: "text-os-accent",
  warn: "text-os-amber bg-os-amber/5",
  error: "text-destructive bg-destructive/10",
};

export function LabConsole({ logs, onClear }: { logs: ConsoleEntry[]; onClear: () => void }) {
  return (
    <section aria-label="Console" className="flex h-full flex-col bg-os-well">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-os-container px-4">
        <h3 className="text-xs font-medium text-os-grey">
          Console{logs.length > 0 && <span className="ml-1.5 tabular-nums text-os-muted">{logs.length}</span>}
        </h3>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 text-xs text-os-muted transition-colors hover:text-foreground"
        >
          <Ban className="h-3 w-3" aria-hidden />
          Clear
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1 font-mono text-xs" role="log" aria-live="polite">
        {logs.length === 0 ? (
          <p className="px-4 py-1 text-os-muted">Console output appears here.</p>
        ) : (
          logs.map((entry) => (
            <p key={entry.id} className={cn("whitespace-pre-wrap break-words px-4 py-1", LEVEL_STYLES[entry.level])}>
              {entry.text}
            </p>
          ))
        )}
      </div>
    </section>
  );
}
