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

import { type MouseEvent as ReactMouseEvent } from "react";
import type { DriveItem } from "~/drive/lib/drive.server";


/** What a row, tile or card does with the pointer; one set, shared by every view. */
export type RowHandlers = {
  /** Plain click selects, cmd/ctrl toggles, shift extends. */
  onClick: (id: string, e: ReactMouseEvent<HTMLElement>) => void;
  /** Double-click opens. */
  onDoubleClick: (id: string, e: ReactMouseEvent<HTMLElement>) => void;
  /** Right-click: focus the row, and select it alone unless it is already selected. */
  onContext: (id: string) => void;
  /** Open (the row menu's "Open"). */
  onOpen: (id: string) => void;
};

export type RowActions = {
  onRename: (item: DriveItem) => void;
  onRequestMove: (item: DriveItem) => void;
  onDelete: (item: DriveItem) => void;
  /** Save a file, or the whole selection when the row is part of one. */
  onDownload?: (item: DriveItem) => void;
  /** Open the in-place Share dialog for a page-backed item (doc, folder, or form). */
  onShare?: (item: DriveItem) => void;
  /** Apply a tag to the Drive's tag filter (clicking a tag dot). */
  onTagClick?: (tagId: string) => void;
  /** Rename, Move and Delete are left off the item menu (the Shared with me space). */
  readOnly?: boolean;
  /** Open Folder settings for a page folder; `canFolderSettings` says which folders have something to set. */
  onFolderSettings?: (item: DriveItem) => void;
  canFolderSettings?: (item: DriveItem) => boolean;
};
