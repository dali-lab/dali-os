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
import { kindLabel } from "./browser-items";
import { itemIcon } from "./item-icons";

export function DriveQuickPreview({ item, onClose }: { item: DriveItem; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cat = item.type === "file" ? categorize({ fileName: item.title || "" }) : "other";
  const isImage = cat === "image";
  const isPdf = cat === "pdf";

  return (
    <div
      className={`fixed inset-0 ${Z.top} flex items-center justify-center bg-black/70 p-6`}
      data-testid="drive-quick-preview"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="flex min-w-0 items-center gap-2">
            {itemIcon(item)}
            <span className="truncate font-medium text-foreground">{item.title || "Untitled"}</span>
          </span>
          <div className="flex items-center gap-2">
            {item.href && (
              <a
                href={item.href}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground hover:bg-muted/60"
              >
                <FolderOpen className="h-3.5 w-3.5" /> Open
              </a>
            )}
            <button
              type="button"
              aria-label="Close preview"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex min-h-[50vh] flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">
          {isImage && item.href ? (
            <img src={item.href} alt={item.title || "Preview"} className="max-h-[70vh] max-w-full object-contain" />
          ) : isPdf && item.href ? (
            <iframe src={item.href} title={item.title || "Preview"} className="h-[70vh] w-full rounded border border-border bg-card" />
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="scale-[2.5]">{itemIcon(item)}</span>
              <p className="text-sm text-muted-foreground">
                No inline preview for this {kindLabel(item).toLowerCase()}.
              </p>
              {item.href && (
                <a
                  href={item.href}
                  className={buttonClasses("primary", "sm")}
                >
                  <FolderOpen className="h-3.5 w-3.5" /> Open
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Column view: droppable scope row (column 0) ──────────────────────────────
