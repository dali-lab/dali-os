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

import { type ReactNode } from "react";
import type { DriveItem } from "~/drive/lib/drive.server";
import { ContextMenu } from "~/components/ui/floating";
import { relativeTime } from "~/lib/relative-time";
import { ProcessLinkPill } from "~/components/drive/ProcessLinkPill";
import { Truncated } from "~/components/ui/Truncated";
import { LocationLink } from "~/components/drive/LocationLink";
import { RowTags } from "./ColumnView";
import { itemMenuItems, RowActionsMenu } from "./RowActionsMenu";
import { BesideMark } from "./beside";
import type { SearchHit } from "./browser-items";
import { useDriveText } from "./drive-text";
import { GRID_COLUMNS_FLAT } from "./drop-zone";
import { ItemGlyphTip } from "./item-icons";
import type { RowHandlers, RowActions } from "./row-types";

export function SearchResults({
  hits,
  selected,
  focusId,
  handlers,
  onOpenLocation,
  getScopeActions,
  onToggleFavorite,
}: {
  hits: SearchHit[];
  selected: Set<string>;
  focusId: string | null;
  handlers: RowHandlers;
  onOpenLocation: (scopeId: string, folderId: string | null) => void;
  getScopeActions: (scopeId: string) => RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
}) {
  const t = useDriveText();
  if (hits.length === 0) return <EmptyLine>No matches.</EmptyLine>;
  return (
    <div className="p-1" data-testid="drive-search-results">
      <div
        className={`grid items-center gap-2 border-b border-border px-2.5 py-1.5 ${t.label} font-medium uppercase tracking-wide text-muted-foreground`}
        style={{ gridTemplateColumns: GRID_COLUMNS_FLAT }}
      >
        <span>Name</span>
        <span>Location</span>
        <span>Modified</span>
        <span aria-hidden="true" />
      </div>
      <div className="flex flex-col divide-y divide-border/50">
        {hits.map((hit) => (
          <ContextMenu
            key={`${hit.scope.id}:${hit.item.id}`}
            items={itemMenuItems(
              hit.item,
              getScopeActions(hit.scope.id),
              () => handlers.onOpen(hit.item.id),
              onToggleFavorite,
            )}
            ariaLabel="Item actions"
          >
            <div
              data-testid={`drive-search-hit-${hit.item.id}`}
              data-item-id={hit.item.id}
              onClick={(e) => handlers.onClick(hit.item.id, e)}
              onDoubleClick={(e) => handlers.onDoubleClick(hit.item.id, e)}
              data-selected={selected.has(hit.item.id)}
              onContextMenu={() => handlers.onContext(hit.item.id)}
              style={{ gridTemplateColumns: GRID_COLUMNS_FLAT }}
              className={`group grid items-center ${t.itemRow} ${t.row} cursor-default select-none rounded-md ${
                selected.has(hit.item.id)
                  ? "bg-os-container"
                  : focusId === hit.item.id
                    ? "bg-os-hover"
                    : "hover:bg-os-hover"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <ItemGlyphTip item={hit.item} />
                <Truncated text={hit.item.title || "Untitled"} className="font-medium text-foreground" />
                <BesideMark item={hit.item} />
<RowTags item={hit.item} actions={getScopeActions(hit.scope.id)} />
                {/* Signal ②: process linkage pill in search results. */}
                {hit.item.linkedProcess && (
                  <ProcessLinkPill label={hit.item.linkedProcess.label} href={hit.item.linkedProcess.href} />
                )}
              </span>
              <LocationLink location={hit.location} onNavigate={onOpenLocation} />
              <span className={`${t.meta} text-muted-foreground tabular-nums truncate`}>
                {relativeTime(hit.item.updatedAt as unknown as string)}
              </span>
              <span className="flex items-center justify-end">
                <RowActionsMenu
                  item={hit.item}
                  actions={getScopeActions(hit.scope.id)}
                  onOpen={() => handlers.onOpen(hit.item.id)}
                  onToggleFavorite={onToggleFavorite}
                />
              </span>
            </div>
          </ContextMenu>
        ))}
      </div>
    </div>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  const t = useDriveText();
  return <p className={`px-3 py-8 text-center ${t.row} text-muted-foreground italic`}>{children}</p>;
}
