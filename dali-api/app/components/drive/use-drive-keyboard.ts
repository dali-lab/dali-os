import { useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { DriveItem } from "~/drive/lib/drive.server";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { isInFloatingLayer } from "~/components/ui/floating";
import { modKey } from "~/lib/shortcuts";
import { gridStepBlocks, perRowFromTops, type GridBlock } from "~/components/drive/grid-nav";
import { openRowIdAt, type ColumnLevel } from "~/components/drive/ColumnView";
import { isPreviewable, type ViewMode } from "~/components/drive/browser-items";
import type { RowActions } from "~/components/drive/row-types";
import type { DriveItemEntry } from "~/components/drive/use-drive-selection";

type Row = { id: string; title: string };

export type DriveKeyboardOptions = {
  searching: boolean;
  columnsActive: boolean;
  viewMode: ViewMode;
  hits: { item: DriveItem }[];
  listing: DriveItem[];
  scopes: DriveTreeScope[];
  currentScope: DriveTreeScope | null;
  levels: ColumnLevel[];
  focusLevel: number;
  setFocusLevel: (level: number) => void;
  levelRows: (levelIdx: number) => Row[];
  itemsForLevel: (level: ColumnLevel) => DriveItem[];
  itemIndex: Map<string, DriveItemEntry>;
  focusId: string | null;
  focusEntry: DriveItemEntry | null;
  selectedItems: DriveItem[];
  focusOnly: (id: string, selectable?: boolean) => void;
  clearSelection: () => void;
  setSelected: (ids: Set<string>) => void;
  previewItem: DriveItem | null;
  setPreviewItem: (item: DriveItem | null) => void;
  listRef: RefObject<HTMLElement | null>;
  goUp: () => void;
  openById: (id: string) => void;
  openFolderInColumn: (levelIdx: number, scopeId: string, folderId: string | null) => void;
  onOpenItem: (item: DriveItem) => void;
  onBulkDelete?: (items: DriveItem[]) => void;
  getInternalScopeActions: (scopeId: string) => RowActions;
};

/** Keyboard navigation for every Drive view; returns the pane's keydown handler. */
export function useDriveKeyboard(o: DriveKeyboardOptions) {
  const typeAhead = useRef<{ buf: string; at: number }>({ buf: "", at: 0 });

  function keyboardRows(): { rows: Row[]; selectable: boolean } {
    if (o.searching) {
      return { rows: o.hits.map((h) => ({ id: h.item.id, title: h.item.title || "" })), selectable: true };
    }
    if (o.columnsActive) return { rows: o.levelRows(o.focusLevel), selectable: o.focusLevel > 0 };
    if (!o.currentScope) return { rows: o.scopes.map((s) => ({ id: s.id, title: s.label })), selectable: false };
    return { rows: o.listing.map((i) => ({ id: i.id, title: i.title || "" })), selectable: true };
  }

  function deleteSelection() {
    if (o.selectedItems.length > 1) {
      o.onBulkDelete?.(o.selectedItems);
      return;
    }
    const entry = o.selectedItems.length === 1 ? o.itemIndex.get(o.selectedItems[0].id) : o.focusEntry;
    if (entry) o.getInternalScopeActions(entry.scopeId).onDelete(entry.item);
  }

  function stepIntoFocus({ openFiles }: { openFiles: boolean }) {
    const { focusId, focusEntry, focusLevel } = o;
    if (!focusId) return;
    let target: { scopeId: string; folderId: string | null } | null = null;
    if (focusLevel === 0) {
      target = { scopeId: focusId, folderId: null };
    } else if (focusEntry?.item.type === "folder") {
      target = { scopeId: focusEntry.scopeId, folderId: focusId };
    } else if (focusEntry && openFiles) {
      o.onOpenItem(focusEntry.item);
    }
    if (!target) return;
    if (openRowIdAt(o.levels, focusLevel) !== focusId) {
      o.openFolderInColumn(focusLevel, target.scopeId, target.folderId);
    }
    o.setFocusLevel(focusLevel + 1);
    const first = o.itemsForLevel({ kind: "scope", ...target })[0];
    if (first) o.focusOnly(first.id);
    else o.clearSelection();
  }

  function stepOutOfFocusLevel() {
    if (o.focusLevel === 0) return;
    const parentLevel = o.focusLevel - 1;
    const openId = openRowIdAt(o.levels, parentLevel);
    o.setFocusLevel(parentLevel);
    if (openId) o.focusOnly(openId, parentLevel > 0);
  }

  function gridBlocks(): GridBlock[] {
    const blocks = o.listRef.current?.querySelectorAll<HTMLElement>("[data-grid-block]") ?? [];
    return Array.from(blocks, (block) => {
      const tiles = Array.from(block.children) as HTMLElement[];
      return { count: tiles.length, perRow: perRowFromTops(tiles.map((tile) => tile.offsetTop)) };
    });
  }

  function onPaneKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (isInFloatingLayer(e.target)) return;
    if ((e.target as Element).closest("input, textarea, select, [contenteditable='true']")) return;
    const mod = modKey(e);

    if (e.key === "Delete" || (mod && e.key === "Backspace")) {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (e.key === "Backspace" || (mod && e.key === "ArrowUp")) {
      e.preventDefault();
      o.goUp();
      return;
    }
    if (e.key === "Escape") {
      if (o.previewItem) {
        o.setPreviewItem(null);
        return;
      }
      o.clearSelection();
      return;
    }

    const { rows, selectable } = keyboardRows();
    if (mod && e.key.toLowerCase() === "a") {
      if (!selectable) return;
      e.preventDefault();
      o.setSelected(new Set(rows.map((r) => r.id)));
      return;
    }
    if (e.key === "F2") {
      if (o.focusEntry) o.getInternalScopeActions(o.focusEntry.scopeId).onRename(o.focusEntry.item);
      return;
    }
    // Before type-ahead, which would otherwise swallow the space.
    if (e.key === " ") {
      if (o.focusEntry && isPreviewable(o.focusEntry.item)) {
        e.preventDefault();
        o.setPreviewItem(o.focusEntry.item);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (o.columnsActive) stepIntoFocus({ openFiles: true });
      else if (o.focusId) o.openById(o.focusId);
      return;
    }

    const idx = o.focusId ? rows.findIndex((r) => r.id === o.focusId) : -1;
    const step = (delta: 1 | -1) => {
      if (rows.length === 0) return;
      e.preventDefault();
      const next = idx === -1 ? 0 : Math.min(Math.max(idx + delta, 0), rows.length - 1);
      o.focusOnly(rows[next].id, selectable);
    };
    const inGrid = o.viewMode === "grid" && !o.searching;
    const stepVertically = (delta: 1 | -1) => {
      const blocks = inGrid ? gridBlocks() : [];
      if (rows.length === 0 || blocks.reduce((n, b) => n + b.count, 0) !== rows.length) return step(delta);
      e.preventDefault();
      o.focusOnly(rows[gridStepBlocks(blocks, idx, delta)].id, selectable);
    };
    if (e.key === "ArrowDown") return stepVertically(1);
    if (e.key === "ArrowUp") return stepVertically(-1);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      if (o.columnsActive) {
        e.preventDefault();
        if (e.key === "ArrowRight") stepIntoFocus({ openFiles: false });
        else stepOutOfFocusLevel();
      } else if (inGrid) {
        step(e.key === "ArrowRight" ? 1 : -1);
      }
      return;
    }

    // Single printable characters only, so it never swallows a shortcut.
    if (e.key.length === 1 && !mod && !e.altKey) {
      const now = Date.now();
      const buf = (now - typeAhead.current.at > 1000 ? "" : typeAhead.current.buf) + e.key.toLowerCase();
      typeAhead.current = { buf, at: now };
      const hit = rows.find((r) => r.title.toLowerCase().startsWith(buf));
      if (hit) {
        e.preventDefault();
        o.focusOnly(hit.id, selectable);
      }
    }
  }

  return { onPaneKeyDown };
}
