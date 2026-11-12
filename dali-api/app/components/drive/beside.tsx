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
import { isGroupScope } from "./item-icons";

/** A drive as a drop target: dropping items on it re-scopes them. Shared by the columns, the list and the grid. */
export function useScopeDrop(scopeId: string, dragging: boolean) {
  return useDroppable({
    id: `scopedrop::${scopeId}`,
    data: { destScopeId: scopeId },
    disabled: !dragging || isGroupScope(scopeId),
  });
}

export type BesideState = { open: ((item: DriveItem) => void) | null; activeId: string | null };

export const BesideContext = createContext<BesideState>({ open: null, activeId: null });

export function besideTarget(item: DriveItem) {
  return item.type === "doc" ? sidePanelForUrl(item.href) : null;
}

/** How a row opens beside: an opener when it can, and whether it is the document showing in the panel now. */
export function useBeside(item: DriveItem) {
  const { open, activeId } = useContext(BesideContext);
  const target = open ? besideTarget(item) : null;
  return { openBeside: target && open ? () => open(item) : null, active: !!target && activeId === target.id };
}

export function BesideMark({ item }: { item: DriveItem }) {
  const { active } = useBeside(item);
  if (!active) return null;
  return <span className="shrink-0 rounded-full bg-os-container px-2 py-0.5 text-xs font-medium text-os-accent">Open beside</span>;
}

export function OpenBesideButton({ item }: { item: DriveItem }) {
  const { openBeside } = useBeside(item);
  if (!openBeside) return null;
  return (
    <Tooltip content="Open to the side · ⌥ click">
      <button
        type="button"
        aria-label="Open to the side"
        data-testid={`drive-item-beside-${item.id}`}
        onClick={(e) => {
          e.stopPropagation();
          openBeside();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
      >
        <PanelRight className="h-4 w-4" />
      </button>
    </Tooltip>
  );
}

export function OpenBesideMenuItem({ item }: { item: DriveItem }) {
  const { openBeside } = useBeside(item);
  if (!openBeside) return null;
  return (
    <Menu.Item icon={<PanelRight className="h-3.5 w-3.5" />} shortcut="⌥ click" onSelect={openBeside}>
      Open to the side
    </Menu.Item>
  );
}
