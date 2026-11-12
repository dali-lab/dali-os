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

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileSignature,
  FileText,
  Presentation,
  Shapes,
  Handshake,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Trash2,
  Download,
  FolderInput,
  HardDrive,
  Search,
  X,
  Star,
  List as ListIcon,
  LayoutGrid,
  Upload,
  FolderOpen,
  Share2,
  Columns,
  ClipboardCheck,
  Mail,
  NotebookPen,
  SlidersHorizontal,
} from "lucide-react";
import type { DriveItem } from "~/drive/lib/drive.server";
import { listedUnderFilter, matchesTypeFilter, type DriveTypeFilter } from "~/components/drive/type-filter";
import { categorize } from "~/lib/file-type";
import { iconForCategory } from "~/lib/file-icon";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { Menu, ContextMenu, Tooltip, isInFloatingLayer } from "~/components/ui/floating";
import { useSidePanel } from "~/components/side-panel/use-side-panel";
import { sidePanelForUrl } from "~/lib/side-panel";
import { ShareDialog, type ShareTarget } from "~/components/sharing/ShareDialog";
import { relativeTime } from "~/lib/relative-time";
import { useRevalidator } from "react-router";
import { useToast } from "~/components/ui/toast";
import { notebookRequest, sendJson } from "~/components/notebooks/notebook-requests";
import { cn } from "~/lib/cn";
import { modKey } from "~/lib/shortcuts";
import { collapseMiddle } from "~/lib/collapse-middle";
import { FAVORITES_SPACE_KEY, isProcessRootSpace, SHARED_SPACE_KEY } from "~/drive/lib/drive-spaces";
import { scopeIconFor } from "~/components/drive/scope-icon";
import { ProcessLinkPill } from "~/components/drive/ProcessLinkPill";
import { AudienceSignal } from "~/components/drive/AudienceSignal";
import { TagDots } from "~/components/drive/TagDots";
import { Button, buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Truncated } from "~/components/ui/Truncated";
import { LoadMore } from "~/components/ui/Pager";
import { useClientSlice } from "~/hooks/useClientSlice";
import { useOsChrome } from "~/components/os-chrome";
import { crumbsFor, driveScopeLabel, locationOf, type ItemLocation } from "~/components/drive/location";
import { LocationLink } from "~/components/drive/LocationLink";
import { menuEntries, type MenuEntry } from "~/components/drive/item-menu";
import { downloadItems, hasDownloadable } from "~/components/drive/download-files";
import { clickIntent } from "~/components/drive/column-click";
import { gridStepBlocks, perRowFromTops, type GridBlock } from "~/components/drive/grid-nav";
import { MarqueeBox, useMarquee } from "~/components/drive/use-marquee";
import { CORAL_FOLDER, glyphLabel, pickGlyph, type ItemGlyph } from "~/components/drive/glyphs";
import { droppedFiles } from "~/components/drive/dropped-files";
import { FolderGlyph, GlyphBadge } from "~/components/drive/FolderGlyph";
import { FolderSettingsModal } from "~/components/drive/FolderSettingsModal";
import { EmptyState } from "~/components/ui/EmptyState";
import { isPageFolder, meetingsOptionFor, receivesLabel } from "~/components/drive/receiver-options";
import { Z } from "~/components/ui/z";


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
