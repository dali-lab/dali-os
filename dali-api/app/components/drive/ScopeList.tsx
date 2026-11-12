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
import { EmptyLine } from "./SearchResults";
import { useScopeDrop } from "./beside";
import { useDriveText } from "./drive-text";
import { GRID_CONTAINER, GRID_TILE, DROP_RING, GRID_LABEL } from "./drop-zone";
import { scopeIcon, scopeLabel } from "./item-icons";

export function ScopeList({
  scopes,
  viewMode,
  focusId,
  dragging,
  onOpen,
}: {
  scopes: DriveTreeScope[];
  /** The drives are the Drive's top folder, so they follow the view toggle too
   *  — in grid view they were the one listing that stayed a row list. */
  viewMode: "list" | "grid";
  focusId: string | null;
  /** An item is being dragged, so the drives accept it. */
  dragging: boolean;
  /** A drive is entered, never selected: any click on it opens it. */
  onOpen: (id: string) => void;
}) {
  if (scopes.length === 0) return <EmptyLine>Your Drive is empty.</EmptyLine>;

  if (viewMode === "grid") {
    return (
      <div className={GRID_CONTAINER} data-testid="drive-listing" data-grid-block>
        {scopes.map((scope) => (
          <ScopeTile key={scope.id} scope={scope} focused={focusId === scope.id} dragging={dragging} onOpen={onOpen} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border/50" data-testid="drive-listing">
      {scopes.map((scope) => (
        <ScopeRow key={scope.id} scope={scope} focused={focusId === scope.id} dragging={dragging} onOpen={onOpen} />
      ))}
    </div>
  );
}

export type ScopeEntryProps = {
  scope: DriveTreeScope;
  focused: boolean;
  dragging: boolean;
  onOpen: (id: string) => void;
};

export function ScopeTile({ scope, focused, dragging, onOpen }: ScopeEntryProps) {
  const drop = useScopeDrop(scope.id, dragging);
  return (
    <div
      ref={drop.setNodeRef}
      data-testid={`drive-scope-${scope.id}`}
      data-row-id={scope.id}
      data-marquee-ignore
      onClick={(e) => {
        e.stopPropagation();
        onOpen(scope.id);
      }}
      className={`${GRID_TILE} ${drop.isOver ? DROP_RING : focused ? "bg-os-container/40" : "hover:bg-os-hover"}`}
    >
      {scopeIcon(scope, "xl")}
      <span className={`${GRID_LABEL} ${focused ? "bg-os-accent text-os-bg" : "text-foreground"}`}>
        {scopeLabel(scope)}
      </span>
    </div>
  );
}

export function ScopeRow({ scope, focused, dragging, onOpen }: ScopeEntryProps) {
  const t = useDriveText();
  const drop = useScopeDrop(scope.id, dragging);
  return (
    <div
      ref={drop.setNodeRef}
      data-testid={`drive-scope-${scope.id}`}
      data-row-id={scope.id}
      data-marquee-ignore
      onClick={(e) => {
        e.stopPropagation();
        onOpen(scope.id);
      }}
      className={`group flex items-center ${t.itemRow} ${t.row} cursor-default select-none rounded-lg ${
        drop.isOver ? DROP_RING : focused ? "bg-os-container text-os-accent" : "hover:bg-os-hover"
      }`}
    >
      {scopeIcon(scope, "sm")}
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{scopeLabel(scope)}</span>
      {/* Signal ③: scope audience chip — hover-reveal via group-hover. */}
      {scope.scopeAudience ? (
        <span
          className={`shrink-0 ${t.badge} tracking-wide text-muted-foreground opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity`}
        >
          {scope.scopeAudience}
        </span>
      ) : null}
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </div>
  );
}

// ── In-scope contents (list + grid) ──────────────────────────────────────────
