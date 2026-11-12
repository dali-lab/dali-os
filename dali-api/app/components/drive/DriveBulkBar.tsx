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

import { Trash2, Download, FolderInput, X } from "lucide-react";
import type { DriveItem } from "~/drive/lib/drive.server";
import { cn } from "~/lib/cn";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useOsChrome } from "~/components/os-chrome";
import { hasDownloadable } from "~/components/drive/download-files";


export function DriveBulkBar({
  showBulk,
  selectedCount,
  selectedItems,
  onBulkDownload,
  downloading,
  onBulkMove,
  onBulkDelete,
  onClearSelection,
}: {
  showBulk: boolean;
  selectedCount: number;
  selectedItems: DriveItem[];
  onBulkDownload: () => void;
  downloading: boolean;
  onBulkMove?: (items: DriveItem[]) => void;
  onBulkDelete?: (items: DriveItem[]) => void;
  onClearSelection: () => void;
}) {
  const { card } = useOsChrome();
  if (!showBulk) return null;
  return (
    <div
      className={cn(
        card,
        "absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 border border-border px-3 py-2 shadow-[0_16px_40px_var(--color-os-shadow)]",
      )}
      data-testid="drive-bulk-bar"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="whitespace-nowrap rounded-full bg-os-container px-2.5 py-1 text-xs font-medium text-foreground">
        {selectedCount} selected
      </span>
      {hasDownloadable(selectedItems) && (
        <Button
          variant="secondary"
          size="sm"
          disabled={downloading}
          data-testid="drive-bulk-download"
          onClick={onBulkDownload}
        >
          <Download className="h-3.5 w-3.5" /> {downloading ? "Preparing…" : "Download"}
        </Button>
      )}
      {onBulkMove && (
        <Button
          variant="secondary"
          size="sm"
          data-testid="drive-bulk-move"
          onClick={() => onBulkMove(selectedItems)}
        >
          <FolderInput className="h-3.5 w-3.5" /> Move
        </Button>
      )}
      {onBulkDelete && (
        <Button
          variant="destructive"
          size="sm"
          data-testid="drive-bulk-delete"
          onClick={() => onBulkDelete(selectedItems)}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      )}
      <IconButton
        label="Clear selection"
        icon={X}
        tooltipSide="top"
        data-testid="drive-bulk-clear"
        onClick={onClearSelection}
      />
    </div>
  );
}

// ── Quick Look overlay (spacebar preview) ────────────────────────────────────
// A fixed, full-screen modal. Renders images/PDFs inline; everything else gets a
// large icon + Open. Escape or a backdrop click closes it.
