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

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronUp, Handshake } from "lucide-react";
import type { DriveItem } from "~/drive/lib/drive.server";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { ContextMenu, Tooltip } from "~/components/ui/floating";
import { relativeTime } from "~/lib/relative-time";
import { SHARED_SPACE_KEY } from "~/drive/lib/drive-spaces";
import { ProcessLinkPill } from "~/components/drive/ProcessLinkPill";
import { Truncated } from "~/components/ui/Truncated";
import { EmptyState } from "~/components/ui/EmptyState";
import { ModifiedCaption, RowTags, RowAudience } from "./ColumnView";
import { itemMenuItems, RowActionsMenu } from "./RowActionsMenu";
import { EmptyLine } from "./SearchResults";
import { useBeside, BesideMark } from "./beside";
import { formatSize, type SortKey, type SortDir } from "./browser-items";
import { useDriveText } from "./drive-text";
import { GRID_COLUMNS, SHARED_GRID_COLUMNS, GRID_CONTAINER, GRID_TILE, acceptsDrops, dropData, useFileDropFolder, DROP_RING, GRID_LABEL } from "./drop-zone";
import { ItemGlyphTip } from "./item-icons";
import type { RowHandlers, RowActions } from "./row-types";

export function ScopeContents({
  scope,
  atScopeTop,
  listing,
  viewMode,
  sort,
  onToggleSort,
  selected,
  focusId,
  handlers,
  actions,
  onToggleFavorite,
  onTogglePartnerVisible,
  dragging,
}: {
  scope: DriveTreeScope;
  /** The space's top level, where folders sit in a band above the files. */
  atScopeTop: boolean;
  listing: DriveItem[];
  viewMode: "list" | "grid";
  sort: { key: SortKey; dir: SortDir };
  onToggleSort: (key: SortKey) => void;
  selected: Set<string>;
  focusId: string | null;
  handlers: RowHandlers;
  actions: RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
  dragging: boolean;
}) {
  const t = useDriveText();
  const isSharedSpace = scope.id === SHARED_SPACE_KEY;
  if (listing.length === 0) {
    return isSharedSpace ? (
      <EmptyLine>Documents shared with you by name appear here.</EmptyLine>
    ) : (
      <EmptyState>This folder is empty. Drop files here to upload.</EmptyState>
    );
  }

  const bandFolders = atScopeTop ? listing.filter((item) => item.type === "folder") : [];
  const files = atScopeTop ? listing.filter((item) => item.type !== "folder") : listing;
  const band =
    bandFolders.length > 0 ? (
      <section aria-label="Folders" data-testid="drive-folder-band">
        <h3 className={`px-2 pb-1.5 pt-1 ${t.label} font-medium uppercase tracking-wide text-muted-foreground`}>
          Folders
        </h3>
        <div data-grid-block className="flex gap-3 overflow-x-auto px-2 pb-3">
          {bandFolders.map((item) => (
            <FolderCard
              key={item.id}
              item={item}
              scopeId={scope.id}
              selected={selected.has(item.id)}
              focused={focusId === item.id}
              handlers={handlers}
              actions={actions}
              onToggleFavorite={onToggleFavorite}
              onTogglePartnerVisible={onTogglePartnerVisible}
            />
          ))}
        </div>
      </section>
    ) : null;
  const filesHeading =
    band && files.length > 0 ? (
      <h3 className={`px-2 pb-1 pt-1 ${t.label} font-medium uppercase tracking-wide text-muted-foreground`}>Files</h3>
    ) : null;

  if (viewMode === "grid") {
    return (
      <div data-testid="drive-listing">
        {band}
        {filesHeading}
        {files.length > 0 && (
          <div className={GRID_CONTAINER} data-grid-block>
            {files.map((item) => (
              <GridTile
                key={item.id}
                item={item}
                scopeId={scope.id}
                selected={selected.has(item.id)}
                focused={focusId === item.id}
                handlers={handlers}
                actions={actions}
                onToggleFavorite={onToggleFavorite}
                onTogglePartnerVisible={onTogglePartnerVisible}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="drive-listing">
      {band}
      {filesHeading}
      {files.length > 0 && (
        <>
          {/* Column header (sortable) */}
          <div
            className={`grid items-center gap-2 border-b border-border px-2 py-1.5 ${t.label} font-medium uppercase tracking-wide text-muted-foreground`}
            style={{ gridTemplateColumns: isSharedSpace ? SHARED_GRID_COLUMNS : GRID_COLUMNS }}
          >
            <SortHeader label="Name" active={sort.key === "name"} dir={sort.dir} onClick={() => onToggleSort("name")} testid="drive-sort-name" />
            {isSharedSpace && (
              <SortHeader label="Shared by" active={sort.key === "shared"} dir={sort.dir} onClick={() => onToggleSort("shared")} testid="drive-sort-shared" />
            )}
            <SortHeader label="Modified" active={sort.key === "modified"} dir={sort.dir} onClick={() => onToggleSort("modified")} testid="drive-sort-modified" />
            <SortHeader label="Size" active={sort.key === "size"} dir={sort.dir} onClick={() => onToggleSort("size")} align="right" testid="drive-sort-size" />
            <span aria-hidden="true" />
          </div>
          <div className="flex flex-col divide-y divide-border/50">
            {files.map((item) => (
              <ListRow
                key={item.id}
                item={item}
                scopeId={scope.id}
                selected={selected.has(item.id)}
                focused={focusId === item.id}
                handlers={handlers}
                actions={actions}
                onToggleFavorite={onToggleFavorite}
                onTogglePartnerVisible={onTogglePartnerVisible}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = "left",
  testid,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
  testid: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "justify-end" : ""} ${active ? "text-foreground" : ""}`}
    >
      {label}
      {active && (dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
  );
}

export function ListRow({
  item,
  scopeId,
  selected,
  focused,
  handlers,
  actions,
  onToggleFavorite,
  onTogglePartnerVisible,
}: {
  item: DriveItem;
  scopeId: string;
  selected: boolean;
  /** The keyboard is on this row. */
  focused: boolean;
  handlers: RowHandlers;
  actions: RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
}) {
  const t = useDriveText();
  const drag = useDraggable({
    id: `${scopeId}::${item.id}`,
    data: { item, scopeId },
  });
  const drop = useDroppable({
    id: `${scopeId}::drop::${item.id}`,
    data: dropData(item, scopeId),
    disabled: !acceptsDrops(item),
  });
  const fileDrop = useFileDropFolder(item);
  const besideActive = useBeside(item).active;
  function setRefs(node: HTMLDivElement | null) {
    drag.setNodeRef(node);
    if (acceptsDrops(item)) drop.setNodeRef(node);
  }

  const row = (
    <div
      ref={setRefs}
      {...drag.attributes}
      {...drag.listeners}
      {...fileDrop.attrs}
      data-testid={`drive-item-${item.type}-${item.id}`}
      data-item-id={item.id}
      onClick={(e) => handlers.onClick(item.id, e)}
      onDoubleClick={(e) => handlers.onDoubleClick(item.id, e)}
      data-selected={selected}
      onContextMenu={() => handlers.onContext(item.id)}
      style={{ gridTemplateColumns: scopeId === SHARED_SPACE_KEY ? SHARED_GRID_COLUMNS : GRID_COLUMNS }}
      className={`group grid items-center dnd-touch-handle ${t.itemRow} rounded-lg ${t.row} cursor-default select-none ${
        drag.isDragging ? "opacity-40" : ""
      } ${
        (drop.isOver && acceptsDrops(item)) || fileDrop.over
          ? DROP_RING
          : selected
            ? "bg-os-container"
            : besideActive
              ? "bg-os-accent/10"
              : focused
                ? "bg-os-hover"
                : "hover:bg-os-hover"
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <ItemGlyphTip item={item} />
        <Truncated text={item.title || "Untitled"} className="font-medium text-foreground" />
        <BesideMark item={item} />
<RowTags item={item} actions={actions} />
        <RowAudience item={item} actions={actions} />
        {/* Signal ②: process linkage pill. */}
        {item.linkedProcess && (
          <ProcessLinkPill label={item.linkedProcess.label} href={item.linkedProcess.href} />
        )}
        {/* Partner-visible badge: teal handshake when shared with the project's partner. */}
        {(item.type === "doc" || item.type === "file") &&
          (item as { partnerVisible?: boolean | null }).partnerVisible && (
            <Tooltip content="Shared with partner">
              <span className="flex items-center text-accent-teal shrink-0">
                <Handshake className="w-3.5 h-3.5" />
              </span>
            </Tooltip>
          )}
      </span>
      {scopeId === SHARED_SPACE_KEY && (
        <span className={`${t.meta} text-muted-foreground truncate`}>
          {item.type === "doc" || item.type === "file" ? (item.sharedBy?.name ?? "Unknown") : ""}
        </span>
      )}
      <span className={`${t.meta} text-muted-foreground tabular-nums truncate`}>{relativeTime(item.updatedAt as unknown as string)}</span>
      <span className={`${t.meta} text-muted-foreground tabular-nums text-right`}>{formatSize(item.sizeBytes)}</span>
      <span className="flex items-center justify-end">
        <RowActionsMenu
          item={item}
          actions={actions}
          onOpen={() => handlers.onOpen(item.id)}
          onToggleFavorite={onToggleFavorite}
          onTogglePartnerVisible={onTogglePartnerVisible}
        />
      </span>
    </div>
  );

  return (
    <ContextMenu
      items={itemMenuItems(item, actions, () => handlers.onOpen(item.id), onToggleFavorite, onTogglePartnerVisible)}
      ariaLabel="Item actions"
    >
      {row}
    </ContextMenu>
  );
}

export function GridTile({
  item,
  scopeId,
  selected,
  focused,
  handlers,
  actions,
  onToggleFavorite,
  onTogglePartnerVisible,
}: {
  item: DriveItem;
  scopeId: string;
  selected: boolean;
  /** The keyboard is on this tile. */
  focused: boolean;
  handlers: RowHandlers;
  actions: RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
}) {
  const t = useDriveText();
  const drag = useDraggable({
    id: `${scopeId}::${item.id}`,
    data: { item, scopeId },
  });
  const drop = useDroppable({
    id: `${scopeId}::drop::${item.id}`,
    data: dropData(item, scopeId),
    disabled: !acceptsDrops(item),
  });
  const fileDrop = useFileDropFolder(item);
  function setRefs(node: HTMLDivElement | null) {
    drag.setNodeRef(node);
    if (acceptsDrops(item)) drop.setNodeRef(node);
  }

  const tile = (
    <div
      ref={setRefs}
      {...drag.attributes}
      {...drag.listeners}
      {...fileDrop.attrs}
      data-testid={`drive-item-${item.type}-${item.id}`}
      data-item-id={item.id}
      onClick={(e) => handlers.onClick(item.id, e)}
      onDoubleClick={(e) => handlers.onDoubleClick(item.id, e)}
      data-selected={selected}
      onContextMenu={() => handlers.onContext(item.id)}
      // No card around a tile: the icon is the object, the way a Finder icon
      // view reads. Selection lives on the label chip below (Finder's blue
      // rectangle), not on a border, so a grid of files reads as a grid of
      // files rather than a grid of boxes.
      className={`${GRID_TILE} dnd-touch-handle ${
        drag.isDragging ? "opacity-40" : ""
      } ${
        (drop.isOver && acceptsDrops(item)) || fileDrop.over
          ? DROP_RING
          : selected
            ? "bg-os-container/40"
            : focused
              ? "bg-os-hover"
              : "hover:bg-os-hover"
      }`}
    >
      <div className="absolute right-1 top-1 flex items-center">
        <RowActionsMenu
          item={item}
          actions={actions}
          onOpen={() => handlers.onOpen(item.id)}
          onToggleFavorite={onToggleFavorite}
          onTogglePartnerVisible={onTogglePartnerVisible}
        />
      </div>
      {/* Partner-visible badge: positioned top-left so it doesn't conflict
          with the actions/star buttons on the right. */}
      {(item.type === "doc" || item.type === "file") &&
        (item as { partnerVisible?: boolean | null }).partnerVisible && (
          <Tooltip content="Shared with partner">
            <span className="absolute left-6 top-1.5 flex items-center text-accent-teal">
              <Handshake className="w-3 h-3" />
            </span>
          </Tooltip>
        )}
      <ItemGlyphTip item={item} size="xl" />
      <Truncated
        text={item.title || "Untitled"}
        className={`${GRID_LABEL} ${
          selected ? "bg-os-accent text-os-bg" : "text-foreground"
        }`}
      />
      <ModifiedCaption item={item} />
      <BesideMark item={item} />
<RowTags item={item} actions={actions} />
      <RowAudience item={item} actions={actions} />
      {/* Signal ②: process linkage pill. Centered below the title. */}
      {item.linkedProcess && (
        <ProcessLinkPill label={item.linkedProcess.label} href={item.linkedProcess.href} />
      )}
    </div>
  );

  return (
    <ContextMenu
      items={itemMenuItems(item, actions, () => handlers.onOpen(item.id), onToggleFavorite, onTogglePartnerVisible)}
      ariaLabel="Item actions"
    >
      {tile}
    </ContextMenu>
  );
}

export function FolderCard({
  item,
  scopeId,
  selected,
  focused,
  handlers,
  actions,
  onToggleFavorite,
  onTogglePartnerVisible,
}: {
  item: DriveItem;
  scopeId: string;
  selected: boolean;
  /** The keyboard is on this card. */
  focused: boolean;
  handlers: RowHandlers;
  actions: RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
}) {
  const t = useDriveText();
  const drag = useDraggable({ id: `${scopeId}::${item.id}`, data: { item, scopeId } });
  const drop = useDroppable({
    id: `${scopeId}::drop::${item.id}`,
    data: { destFolderId: item.id, destScopeId: scopeId },
  });
  const fileDrop = useFileDropFolder(item);
  function setRefs(node: HTMLDivElement | null) {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  }

  const card = (
    <div
      ref={setRefs}
      {...drag.attributes}
      {...drag.listeners}
      {...fileDrop.attrs}
      data-testid={`drive-item-${item.type}-${item.id}`}
      data-item-id={item.id}
      onClick={(e) => handlers.onClick(item.id, e)}
      onDoubleClick={(e) => handlers.onDoubleClick(item.id, e)}
      data-selected={selected}
      onContextMenu={() => handlers.onContext(item.id)}
      className={`group relative flex w-48 shrink-0 flex-col gap-3 rounded-os-card border border-border p-3 dnd-touch-handle cursor-default select-none transition-colors ${
        drag.isDragging ? "opacity-40" : ""
      } ${
        drop.isOver || fileDrop.over
          ? DROP_RING
          : selected
            ? "bg-os-container"
            : focused
              ? "bg-os-hover"
              : "bg-os-card hover:bg-os-card-hover"
      }`}
    >
      <div className="absolute right-1.5 top-1.5 flex items-center">
        <RowActionsMenu
          item={item}
          actions={actions}
          onOpen={() => handlers.onOpen(item.id)}
          onToggleFavorite={onToggleFavorite}
          onTogglePartnerVisible={onTogglePartnerVisible}
        />
      </div>
      <ItemGlyphTip item={item} size="lg" />
      <div className="flex min-w-0 flex-col gap-1">
        <Truncated text={item.title || "Untitled"} className={`${t.row} font-medium text-foreground`} />
        <span className="flex items-center gap-2">
          <ModifiedCaption item={item} />
          <BesideMark item={item} />
<RowTags item={item} actions={actions} />
          <RowAudience item={item} actions={actions} />
        </span>
      </div>
    </div>
  );

  return (
    <ContextMenu
      items={itemMenuItems(item, actions, () => handlers.onOpen(item.id), onToggleFavorite, onTogglePartnerVisible)}
      ariaLabel="Item actions"
    >
      {card}
    </ContextMenu>
  );
}

// ── Search results ───────────────────────────────────────────────────────────
