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

import { createContext, useContext } from "react";
import type { DriveItem } from "~/drive/lib/drive.server";


/** Give the keyboard to the pane a row sits in, so arrows and shortcuts work without a second click. */
export function focusPane(el: Element) {
  el.closest<HTMLElement>("[data-drive-pane]")?.focus({ preventScroll: true });
}

export const GRID_COLUMNS = "minmax(0,1fr) 9rem 5rem 3.75rem";

/** Flat listings (search, tag and type results) trade Size for where the item lives. */
export const GRID_COLUMNS_FLAT = "minmax(0,1fr) minmax(0,16rem) 5rem 2rem";

export const SHARED_GRID_COLUMNS = "minmax(0,1fr) 9rem 9rem 5rem 3.75rem";

/** Icon-view geometry, shared by the drive tiles and the item tiles. Fixed cell
 *  width (not `1fr`) so a sparse row doesn't stretch one tile across the pane —
 *  Finder-style: the icon is the object, the caption sits under it. */
export const GRID_CONTAINER =
  "grid grid-cols-[repeat(auto-fill,minmax(5.75rem,5.75rem))] justify-start gap-x-2 gap-y-3 px-3 py-3";

export const GRID_TILE =
  "group relative flex flex-col items-center gap-1 rounded-lg px-0.5 py-2 text-center cursor-default select-none";

export function isNotebookItem(item: DriveItem): boolean {
  return item.type === "doc" && !!item.isNotebook;
}

export function isPlainDocument(item: DriveItem): boolean {
  return item.type === "doc" && !item.isNotebook && !item.isWhiteboard && !item.isSlides;
}

export function acceptsDrops(item: DriveItem): boolean {
  return item.type === "folder" || isNotebookItem(item);
}

export function dropData(item: DriveItem, scopeId: string | null) {
  const destScopeId = scopeId ?? undefined;
  return isNotebookItem(item)
    ? { destNotebookId: item.id, destScopeId }
    : { destFolderId: item.id, destScopeId };
}

/** Where a drop of OS files lands when it is not on the current folder: the folder under the pointer. */
export type FileDropOptions = { folderId?: string; skippedFolders?: number };

export const FILE_DROP_ATTR = "data-file-drop-folder";

/** The folder row or tile under a drag event's target, if any. */
export function fileDropFolderAt(e: React.DragEvent): string | null {
  const el = e.target instanceof Element ? e.target.closest(`[${FILE_DROP_ATTR}]`) : null;
  return el?.getAttribute(FILE_DROP_ATTR) ?? null;
}

/** The folder a dragged OS file is hovering, so its row or tile can light up. */
export const FileDropContext = createContext<string | null>(null);

/** Marks a folder as an upload target for dropped OS files and says whether a file drag is on it now. */
export function useFileDropFolder(item: DriveItem) {
  const over = useContext(FileDropContext) === item.id;
  const attrs = item.type === "folder" ? { [FILE_DROP_ATTR]: item.id } : {};
  return { over, attrs };
}

/** What a row, tile, card or crumb looks like while a dragged item hovers it as a drop target; one look in every view. */
export const DROP_RING = "bg-os-accent/10 ring-2 ring-inset ring-os-accent";

export const DROP_OVERLAY =
  "pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-os-card border-2 border-dashed border-os-accent bg-os-accent/10";

/** Caption under a grid icon — always smaller than the artwork, even under os. */
export const GRID_LABEL = "max-w-full truncate rounded px-1.5 py-0.5 text-xs font-medium";

// ── Miller column types ──────────────────────────────────────────────────────
