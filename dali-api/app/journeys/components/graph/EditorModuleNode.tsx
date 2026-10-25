import type { KeyboardEvent, PointerEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "~/lib/cn";
import { moduleTitle } from "~/journeys/lib/journey";
import type { JourneyModule, Point } from "~/journeys/lib/types";
import { NODE_WIDTH } from "./graph-geometry";
import { ModuleMeta, StartBadge } from "./ModuleNode";

export type ConnectState = "idle" | "valid" | "invalid";

export function EditorModuleNode({
  module: mod,
  position,
  selected,
  dragging,
  connectState,
  issueCount,
  measureRef,
  onBodyPointerDown,
  onHandlePointerDown,
  onKeyDown,
}: {
  module: JourneyModule;
  /** Where to draw it: the stored position, or the live one mid-drag. */
  position: Point;
  selected: boolean;
  dragging: boolean;
  /** While a connection is being drawn: whether this node would accept it. */
  connectState: ConnectState;
  issueCount: number;
  measureRef?: (el: HTMLElement | null) => void;
  onBodyPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onHandlePointerDown: (e: PointerEvent<HTMLSpanElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const title = moduleTitle(mod);
  return (
    <div
      ref={measureRef}
      data-graph-node
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={issueCount > 0 ? `${title}, ${issueCount} ${issueCount === 1 ? "issue" : "issues"}` : title}
      onPointerDown={onBodyPointerDown}
      onKeyDown={onKeyDown}
      style={{ left: position.x, top: position.y, width: NODE_WIDTH }}
      className={cn(
        "absolute rounded-os-item border bg-os-card p-4 transition-[border-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent focus-visible:ring-offset-2 focus-visible:ring-offset-os-well",
        dragging ? "z-10 cursor-grabbing shadow-lg" : "cursor-grab",
        selected ? "border-os-accent" : "border-os-container hover:border-os-container-hi",
        connectState === "valid" && "border-os-accent ring-2 ring-os-accent/40",
        connectState === "invalid" && "opacity-50",
      )}
    >
      <span
        aria-hidden
        className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-os-well bg-os-muted"
      />
      {mod.dependsOn.length === 0 && <StartBadge label="Start" />}
      <p className={cn("text-sm font-semibold leading-5", mod.title.trim() ? "text-foreground" : "text-os-muted")}>{title}</p>
      <ModuleMeta module={mod} showDuration={false} detailedLab />
      {issueCount > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-os-amber">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {issueCount} {issueCount === 1 ? "issue" : "issues"}
        </p>
      )}
      <span
        data-graph-handle
        title="Drag to another module to make this a prerequisite"
        onPointerDown={onHandlePointerDown}
        className="absolute -right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 cursor-crosshair place-items-center"
      >
        <span className="h-3 w-3 rounded-full border-2 border-os-well bg-os-accent transition-transform hover:scale-125" />
      </span>
    </div>
  );
}
