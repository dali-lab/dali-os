import { X } from "lucide-react";
import { cn } from "~/lib/cn";

export function EditorTabs({
  tabs,
  activePath,
  onSelect,
  onClose,
}: {
  tabs: string[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Open files" className="flex h-10 shrink-0 overflow-x-auto border-b border-os-container bg-os-bg">
      {tabs.map((path) => {
        const active = path === activePath;
        return (
          <div
            key={path}
            className={cn(
              "group relative flex shrink-0 items-center border-r border-os-container",
              active ? "bg-os-well text-foreground" : "text-os-muted hover:text-os-grey",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              title={path}
              onClick={() => onSelect(path)}
              className="h-full pl-3 pr-1.5 font-mono text-xs"
            >
              {path.split("/").pop()}
            </button>
            <button
              type="button"
              aria-label={`Close ${path}`}
              onClick={() => onClose(path)}
              className={cn(
                "mr-1.5 grid h-5 w-5 place-items-center rounded transition-opacity hover:bg-os-container",
                active ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover:opacity-100 touch:opacity-100",
              )}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
            {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-os-accent" aria-hidden />}
          </div>
        );
      })}
    </div>
  );
}
