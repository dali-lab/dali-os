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

import { type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Handshake } from "lucide-react";
import type { DriveItem } from "~/drive/lib/drive.server";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { Tooltip } from "~/components/ui/floating";
import { relativeTime } from "~/lib/relative-time";
import { ProcessLinkPill } from "~/components/drive/ProcessLinkPill";
import { AudienceSignal } from "~/components/drive/AudienceSignal";
import { TagDots } from "~/components/drive/TagDots";
import { Truncated } from "~/components/ui/Truncated";
import { crumbsFor } from "~/components/drive/location";
import { MarqueeBox, useMarquee } from "~/components/drive/use-marquee";
import { RowActionsMenu } from "./RowActionsMenu";
import { useScopeDrop, useBeside, BesideMark } from "./beside";
import { useDriveText } from "./drive-text";
import { acceptsDrops, dropData, useFileDropFolder, DROP_RING } from "./drop-zone";
import { ItemGlyphTip, scopeIcon, scopeLabel } from "./item-icons";
import type { RowHandlers, RowActions } from "./row-types";

// Each "level" in the column stack is either the scope root or a folder inside
// a scope. The column renders that level's children.
export type ColumnLevel =
  | { kind: "root" }
  | { kind: "scope"; scopeId: string; folderId: string | null };

/**
 * The column stack for a location:
 *   Col 0: all scopes
 *   Col 1: the scope's top level
 *   Col k: the children of the (k-1)th folder crumb
 * so a column's open row is the folder the next column shows (see `openRowIdAt`).
 */
export function columnLevels(
  currentScopeId: string | null,
  currentFolderId: string | null,
  scopes: DriveTreeScope[],
): ColumnLevel[] {
  const scope = currentScopeId ? scopes.find((s) => s.id === currentScopeId) : undefined;
  if (!currentScopeId || !scope) return [{ kind: "root" }];
  const levels: ColumnLevel[] = [
    { kind: "root" },
    { kind: "scope", scopeId: currentScopeId, folderId: null },
  ];
  for (const crumb of crumbsFor(scope.items, currentFolderId)) {
    levels.push({ kind: "scope", scopeId: currentScopeId, folderId: crumb.id });
  }
  return levels;
}

/** The row a column has open: the scope for column 0, else the folder whose children the next column shows. */
export function openRowIdAt(levels: ColumnLevel[], levelIdx: number): string | null {
  const next = levels[levelIdx + 1];
  if (!next || next.kind !== "scope") return null;
  return levelIdx === 0 ? next.scopeId : next.folderId;
}

// ── Main component ───────────────────────────────────────────────────────────

export function ColumnScopeRow({
  scope,
  isOpen,
  isFocused,
  isDragging,
  onClick,
}: {
  scope: DriveTreeScope;
  /** This is the drive the columns to the right are showing. */
  isOpen: boolean;
  /** The keyboard is on this row. */
  isFocused: boolean;
  isDragging: boolean;
  onClick: () => void;
}) {
  const t = useDriveText();
  const drop = useScopeDrop(scope.id, isDragging);

  // Signal ③: audience chip revealed on hover, when the scope carries a scopeAudience label.
  // Reuses the PageRow opacity-reveal convention.
  const audienceChip = scope.scopeAudience ? (
    <span className="shrink-0 text-[10px] tracking-wide text-muted-foreground opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      {scope.scopeAudience}
    </span>
  ) : null;

  return (
    <div
      ref={drop.setNodeRef}
      data-testid={`drive-scope-${scope.id}`}
      data-col-level={0}
      data-row-id={scope.id}
      data-marquee-ignore
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`group flex items-center rounded-lg ${t.itemRow} ${t.row} cursor-default select-none ${
        drop.isOver
          ? `${DROP_RING} text-os-accent`
          : isOpen
            ? "bg-os-container text-foreground"
            : "text-foreground hover:bg-os-hover"
      } ${isFocused && !drop.isOver ? "ring-1 ring-inset ring-os-accent/50" : ""}`}
    >
      {scopeIcon(scope, "sm")}
      <span className="min-w-0 flex-1 truncate font-medium">{scopeLabel(scope)}</span>
      {audienceChip}
    </div>
  );
}

// ── Column view: draggable item row (columns 1+) ──────────────────────────────

export function ColumnItemRow({
  item,
  scopeId,
  levelIdx,
  isOpen,
  isFocused,
  isSelected,
  scopeActions,
  onToggleFavorite,
  onTogglePartnerVisible,
  handlers,
  onContextMenu,
}: {
  item: DriveItem;
  scopeId: string | null;
  /** Which column this row is in — keyboard navigation scrolls by it. */
  levelIdx: number;
  /** This is the folder whose contents the next column shows. */
  isOpen: boolean;
  /** The keyboard is on this row. */
  isFocused: boolean;
  isSelected: boolean;
  scopeActions: RowActions | null;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
  handlers: RowHandlers;
  /** Handed down by the wrapping ContextMenu, which opens the menu from it. */
  onContextMenu?: (e: ReactMouseEvent) => void;
}) {
  const t = useDriveText();
  const drag = useDraggable({
    id: `col::${scopeId}::${item.id}`,
    data: { item, scopeId },
    disabled: !scopeId,
  });
  // Folders in a column accept drops, the same way the list/grid rows do —
  // dragging into a folder is the gesture this view is shaped around, and
  // without it the column view could only move things via the crumb trail.
  const drop = useDroppable({
    id: `col::drop::${scopeId}::${item.id}`,
    data: dropData(item, scopeId),
    disabled: !acceptsDrops(item) || !scopeId,
  });
  const fileDrop = useFileDropFolder(item);
  const besideActive = useBeside(item).active;
  function setRefs(node: HTMLDivElement | null) {
    drag.setNodeRef(node);
    if (acceptsDrops(item)) drop.setNodeRef(node);
  }

  return (
    <div
      ref={setRefs}
      {...drag.attributes}
      {...drag.listeners}
      {...fileDrop.attrs}
      data-testid={`drive-item-${item.type}-${item.id}`}
      data-col-level={levelIdx}
      data-row-id={item.id}
      data-item-id={item.id}
      onClick={(e) => handlers.onClick(item.id, e)}
      onDoubleClick={(e) => handlers.onDoubleClick(item.id, e)}
      data-selected={isSelected}
      onContextMenu={(e) => {
        handlers.onContext(item.id);
        onContextMenu?.(e);
      }}
      className={`group flex items-center rounded-lg dnd-touch-handle ${t.itemRow} ${t.row} cursor-default select-none ${
        drag.isDragging ? "opacity-40" : ""
      } ${
        drop.isOver || fileDrop.over ? DROP_RING : ""
      } ${
        isSelected
          ? "bg-os-container text-os-accent"
          : isOpen
            ? "bg-os-container text-foreground"
            : besideActive
              ? "bg-os-accent/10 text-foreground"
              : "text-foreground hover:bg-os-hover"
      } ${isFocused && !drop.isOver && !fileDrop.over ? "ring-1 ring-inset ring-os-accent/50" : ""}`}
    >
      <ItemGlyphTip item={item} />
      <Truncated text={item.title || "Untitled"} className="flex-1 font-medium" />
      <ModifiedCaption item={item} />
      <BesideMark item={item} />
<RowTags item={item} actions={scopeActions} />
      <RowAudience item={item} actions={scopeActions} />
      {/* Signal ②: process linkage pill. */}
      {item.linkedProcess && (
        <ProcessLinkPill label={item.linkedProcess.label} href={item.linkedProcess.href} />
      )}
      {/* Partner-visible badge: teal handshake shown when this doc/file is
          shared with the project's partner org. */}
      {(item.type === "doc" || item.type === "file") &&
        (item as { partnerVisible?: boolean | null }).partnerVisible && (
          <Tooltip content="Shared with partner">
            <span className="flex items-center text-accent-teal shrink-0">
              <Handshake className="w-3.5 h-3.5" />
            </span>
          </Tooltip>
        )}
      {/* Actions menu */}
      {scopeActions && (
        <RowActionsMenu
          item={item}
          actions={scopeActions}
          onOpen={() => handlers.onOpen(item.id)}
          onToggleFavorite={onToggleFavorite}
          onTogglePartnerVisible={onTogglePartnerVisible}
        />
      )}
    </div>
  );
}

// ── Column view: preview column (rightmost, for the selected leaf) ────────────

/**
 * One column's sizing — every column in the row wears it, preview included.
 * Equal shares of the frame while they fit (so a single column at a drive's top
 * level fills the panel rather than leaving it empty beside a 240px sliver),
 * then a floor that stops them squeezing and hands the overflow to the row's
 * horizontal scroll, the way Finder's columns behave.
 */
export const COLUMN_SIZE = "flex-1 min-w-[12.5rem]";

/** "12 items" / "Empty" after a folder's name; nothing for other items or before counts load. */
/** When the item last changed, after its name in the listings that have no Modified column. */
export function ModifiedCaption({ item, className = "" }: { item: DriveItem; className?: string }) {
  const t = useDriveText();
  // A project or offering row is drawn by the app, not edited: it has no modified time.
  if (item.type === "folder" && item.system) return null;
  return (
    <span data-testid="item-modified" className={`shrink-0 ${t.meta} text-muted-foreground tabular-nums ${className}`}>
      {relativeTime(item.updatedAt as unknown as string)}
    </span>
  );
}

/** Tag dots after a row's title; clicking one filters the Drive by that tag. */
export function RowTags({ item, actions }: { item: DriveItem; actions: RowActions | null }) {
  if (item.type !== "doc" && item.type !== "folder" && item.type !== "form") return null;
  return <TagDots tags={item.tags} onApply={actions?.onTagClick} />;
}

/** The audience marker for a row; clicking opens Share for items that have one. */
export function RowAudience({ item, actions }: { item: DriveItem; actions: RowActions | null }) {
  if (item.type !== "doc" && item.type !== "folder" && item.type !== "file" && item.type !== "form") return null;
  if (!item.audience) return null;
  const share = item.type !== "file" ? actions?.onShare : undefined;
  return <AudienceSignal audience={item.audience} onOpenShare={share ? () => share(item) : undefined} />;
}

// ── Miller column wrapper ─────────────────────────────────────────────────────

export function MillerColumn({
  children,
  testid,
  isEmpty,
  emptyMessage,
  marquee,
}: {
  children: ReactNode;
  testid?: string;
  isEmpty: boolean;
  emptyMessage: ReactNode;
  /** Drag-to-select on the column's empty space; omitted for the list of drives. */
  marquee?: Parameters<typeof useMarquee>[0];
}) {
  const t = useDriveText();
  const { box, handlers } = useMarquee(marquee ?? { enabled: false, getSelected: () => new Set(), onSelect: () => {}, onDragEnd: () => {} });
  return (
    <div
      data-testid={testid}
      {...handlers}
      // Every column shares the row on the same terms (COLUMN_SIZE) and caps
      // at the frame's own height, scrolling a long folder inside the panel
      // rather than down the page.
      className={`relative flex ${COLUMN_SIZE} flex-col overflow-y-auto max-h-[420px] p-1.5`}
    >
      <MarqueeBox box={box} />
      {isEmpty ? (
        typeof emptyMessage === "string" ? (
          <p className={`px-2.5 py-4 ${t.meta} text-os-muted`}>{emptyMessage}</p>
        ) : (
          emptyMessage
        )
      ) : (
        <div className="flex flex-col">{children}</div>
      )}
    </div>
  );
}

// ── Breadcrumb (with overflow collapse) ──────────────────────────────────────
