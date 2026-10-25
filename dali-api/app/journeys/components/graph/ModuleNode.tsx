import { CheckCircle2, CircleDot, FlaskConical, ListChecks, Lock } from "lucide-react";
import { cn } from "~/lib/cn";
import { hasLab, moduleTitle } from "~/journeys/lib/journey";
import type { JourneyModule, ModuleStatus } from "~/journeys/lib/types";
import { NODE_WIDTH } from "./graph-geometry";

/** The "20 min · 3 pages · Lab · Quiz" line under a module's title. */
export function ModuleMeta({
  module: mod,
  showDuration = true,
  detailedLab = false,
}: {
  module: JourneyModule;
  showDuration?: boolean;
  /** Name the kind of lab ("Whiteboard lab", "4 lab steps") instead of just "Lab". */
  detailedLab?: boolean;
}) {
  const labLabel = !detailedLab
    ? "Lab"
    : mod.lab
      ? `${mod.lab.steps.length} lab steps`
      : mod.studio?.kind === "canvas"
        ? "Whiteboard lab"
        : "Document lab";
  const items = [
    showDuration && mod.duration.trim() ? <span key="d">{mod.duration}</span> : null,
    <span key="p">
      {mod.pages.length} {mod.pages.length === 1 ? "page" : "pages"}
    </span>,
    hasLab(mod) ? (
      <span key="l" className="inline-flex items-center gap-1">
        <FlaskConical className="h-3 w-3" aria-hidden />
        {labLabel}
      </span>
    ) : null,
    mod.quiz ? (
      <span key="q" className="inline-flex items-center gap-1">
        <ListChecks className="h-3 w-3" aria-hidden />
        Quiz
      </span>
    ) : null,
  ].filter(Boolean);
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-os-muted">
      {items.flatMap((item, i) => (i === 0 ? [item] : [<span key={`s${i}`} aria-hidden>·</span>, item]))}
    </span>
  );
}

export function StartBadge({ label }: { label: string }) {
  return (
    <span className="absolute -top-2.5 left-4 rounded-full bg-os-accent px-2 py-0.5 text-[11px] font-semibold text-os-bg">
      {label}
    </span>
  );
}

const STATUS_ICON = {
  completed: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-os-green" aria-hidden />,
  available: <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-os-accent" aria-hidden />,
  locked: <Lock className="mt-0.5 h-4 w-4 shrink-0 text-os-muted" aria-hidden />,
} as const;

const STATUS_LABEL: Record<ModuleStatus, string> = {
  completed: "Completed",
  available: "Ready to start",
  locked: "Locked",
};

export function ModuleNode({
  module: mod,
  status,
  selected,
  onSelect,
  measureRef,
}: {
  module: JourneyModule;
  status: ModuleStatus;
  selected: boolean;
  onSelect: () => void;
  measureRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <button
      ref={measureRef}
      type="button"
      data-graph-node
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${moduleTitle(mod)}, ${STATUS_LABEL[status]}`}
      style={{ left: mod.position.x, top: mod.position.y, width: NODE_WIDTH }}
      className={cn(
        "absolute cursor-pointer rounded-os-item border p-4 text-left transition-[border-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent focus-visible:ring-offset-2 focus-visible:ring-offset-os-well",
        status === "completed" && "border-os-green/40 bg-os-card hover:border-os-green/70",
        status === "available" && "border-os-accent/60 bg-os-card hover:border-os-accent",
        status === "locked" && "border-os-container bg-os-bg hover:border-os-container-hi",
        selected && "ring-2 ring-os-accent ring-offset-4 ring-offset-os-well",
      )}
    >
      {mod.dependsOn.length === 0 && <StartBadge label="Start here" />}
      <span className="flex items-start gap-3">
        {STATUS_ICON[status]}
        <span className="min-w-0">
          <span className={cn("block text-sm font-semibold leading-5", status === "locked" ? "text-os-grey" : "text-foreground")}>
            {moduleTitle(mod)}
          </span>
          <ModuleMeta module={mod} />
        </span>
      </span>
    </button>
  );
}
