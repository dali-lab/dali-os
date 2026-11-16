// DriveBrowser — the unified Drive's browser, in three views over one model.
//
// VIEWS: Miller columns (the default, Finder-style), list and grid. Search
//   results are a flat list. All of them share one interaction model: a plain
//   click selects, cmd/ctrl-click toggles, shift-click extends, a rubber-band
//   drag selects, a double-click opens (a folder is entered), and one keyboard
//   handler drives every view.
//
// Also here: type filter, search, drag-and-drop internal move, drag-to-upload,
//   favorites, rename, move, delete, bulk actions, context menu, breadcrumb, sort.

import { ChevronRight } from "lucide-react";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { EmptyLine } from "./SearchResults";
import { useScopeDrop } from "./beside";
import { useDriveText } from "./drive-text";
import { GRID_CONTAINER, GRID_TILE, DROP_RING, GRID_LABEL } from "./drop-zone";
import { scopeIcon, scopeLabel } from "./item-icons";

export function ScopeList({
  scopes,
  viewMode,
  focusId,
  dragging,
  onOpen,
}: {
  scopes: DriveTreeScope[];
  /** The drives are the Drive's top folder, so they follow the view toggle too
   *  — in grid view they were the one listing that stayed a row list. */
  viewMode: "list" | "grid";
  focusId: string | null;
  /** An item is being dragged, so the drives accept it. */
  dragging: boolean;
  /** A drive is entered, never selected: any click on it opens it. */
  onOpen: (id: string) => void;
}) {
  if (scopes.length === 0) return <EmptyLine>Your Drive is empty.</EmptyLine>;

  if (viewMode === "grid") {
    return (
      <div className={GRID_CONTAINER} data-testid="drive-listing" data-grid-block>
        {scopes.map((scope) => (
          <ScopeTile key={scope.id} scope={scope} focused={focusId === scope.id} dragging={dragging} onOpen={onOpen} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border/50" data-testid="drive-listing">
      {scopes.map((scope) => (
        <ScopeRow key={scope.id} scope={scope} focused={focusId === scope.id} dragging={dragging} onOpen={onOpen} />
      ))}
    </div>
  );
}

export type ScopeEntryProps = {
  scope: DriveTreeScope;
  focused: boolean;
  dragging: boolean;
  onOpen: (id: string) => void;
};

export function ScopeTile({ scope, focused, dragging, onOpen }: ScopeEntryProps) {
  const drop = useScopeDrop(scope.id, dragging);
  return (
    <div
      ref={drop.setNodeRef}
      data-testid={`drive-scope-${scope.id}`}
      data-row-id={scope.id}
      data-marquee-ignore
      onClick={(e) => {
        e.stopPropagation();
        onOpen(scope.id);
      }}
      className={`${GRID_TILE} ${drop.isOver ? DROP_RING : focused ? "bg-os-container/40" : "hover:bg-os-hover"}`}
    >
      {scopeIcon(scope, "xl")}
      <span className={`${GRID_LABEL} ${focused ? "bg-os-accent text-os-bg" : "text-foreground"}`}>
        {scopeLabel(scope)}
      </span>
    </div>
  );
}

export function ScopeRow({ scope, focused, dragging, onOpen }: ScopeEntryProps) {
  const t = useDriveText();
  const drop = useScopeDrop(scope.id, dragging);
  return (
    <div
      ref={drop.setNodeRef}
      data-testid={`drive-scope-${scope.id}`}
      data-row-id={scope.id}
      data-marquee-ignore
      onClick={(e) => {
        e.stopPropagation();
        onOpen(scope.id);
      }}
      className={`group flex items-center ${t.itemRow} ${t.row} cursor-default select-none rounded-lg ${
        drop.isOver ? DROP_RING : focused ? "bg-os-container text-os-accent" : "hover:bg-os-hover"
      }`}
    >
      {scopeIcon(scope, "sm")}
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{scopeLabel(scope)}</span>
      {/* Signal ③: scope audience chip — hover-reveal via group-hover. */}
      {scope.scopeAudience ? (
        <span
          className={`shrink-0 ${t.badge} tracking-wide text-muted-foreground opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity`}
        >
          {scope.scopeAudience}
        </span>
      ) : null}
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </div>
  );
}

// ── In-scope contents (list + grid) ──────────────────────────────────────────
