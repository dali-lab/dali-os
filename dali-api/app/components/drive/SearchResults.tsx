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
import { RowTags } from "./ColumnView";
import { itemMenuItems, RowActionsMenu } from "./RowActionsMenu";
import { BesideMark } from "./beside";
import type { SearchHit } from "./browser-items";
import { useDriveText } from "./drive-text";
import { GRID_COLUMNS_FLAT } from "./drop-zone";
import { ItemGlyphTip } from "./item-icons";
import type { RowHandlers, RowActions } from "./row-types";

export function SearchResults({
  hits,
  selected,
  focusId,
  handlers,
  onOpenLocation,
  getScopeActions,
  onToggleFavorite,
}: {
  hits: SearchHit[];
  selected: Set<string>;
  focusId: string | null;
  handlers: RowHandlers;
  onOpenLocation: (scopeId: string, folderId: string | null) => void;
  getScopeActions: (scopeId: string) => RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
}) {
  const t = useDriveText();
  if (hits.length === 0) return <EmptyLine>No matches.</EmptyLine>;
  return (
    <div className="p-1" data-testid="drive-search-results">
      <div
        className={`grid items-center gap-2 border-b border-border px-2.5 py-1.5 ${t.label} font-medium uppercase tracking-wide text-muted-foreground`}
        style={{ gridTemplateColumns: GRID_COLUMNS_FLAT }}
      >
        <span>Name</span>
        <span>Location</span>
        <span>Modified</span>
        <span aria-hidden="true" />
      </div>
      <div className="flex flex-col divide-y divide-border/50">
        {hits.map((hit) => (
          <ContextMenu
            key={`${hit.scope.id}:${hit.item.id}`}
            items={itemMenuItems(
              hit.item,
              getScopeActions(hit.scope.id),
              () => handlers.onOpen(hit.item.id),
              onToggleFavorite,
            )}
            ariaLabel="Item actions"
          >
            <div
              data-testid={`drive-search-hit-${hit.item.id}`}
              data-item-id={hit.item.id}
              onClick={(e) => handlers.onClick(hit.item.id, e)}
              onDoubleClick={(e) => handlers.onDoubleClick(hit.item.id, e)}
              data-selected={selected.has(hit.item.id)}
              onContextMenu={() => handlers.onContext(hit.item.id)}
              style={{ gridTemplateColumns: GRID_COLUMNS_FLAT }}
              className={`group grid items-center ${t.itemRow} ${t.row} cursor-default select-none rounded-md ${
                selected.has(hit.item.id)
                  ? "bg-os-container"
                  : focusId === hit.item.id
                    ? "bg-os-hover"
                    : "hover:bg-os-hover"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <ItemGlyphTip item={hit.item} />
                <Truncated text={hit.item.title || "Untitled"} className="font-medium text-foreground" />
                <BesideMark item={hit.item} />
<RowTags item={hit.item} actions={getScopeActions(hit.scope.id)} />
                {/* Signal ②: process linkage pill in search results. */}
                {hit.item.linkedProcess && (
                  <ProcessLinkPill label={hit.item.linkedProcess.label} href={hit.item.linkedProcess.href} />
                )}
              </span>
              <LocationLink location={hit.location} onNavigate={onOpenLocation} />
              <span className={`${t.meta} text-muted-foreground tabular-nums truncate`}>
                {relativeTime(hit.item.updatedAt as unknown as string)}
              </span>
              <span className="flex items-center justify-end">
                <RowActionsMenu
                  item={hit.item}
                  actions={getScopeActions(hit.scope.id)}
                  onOpen={() => handlers.onOpen(hit.item.id)}
                  onToggleFavorite={onToggleFavorite}
                />
              </span>
            </div>
          </ContextMenu>
        ))}
      </div>
    </div>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  const t = useDriveText();
  return <p className={`px-3 py-8 text-center ${t.row} text-muted-foreground italic`}>{children}</p>;
}
