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
import { OpenBesideButton, OpenBesideMenuItem } from "./beside";
import type { RowActions } from "./row-types";

// Menu.Item nodes shared by the row "⋯" dropdown and the right-click menu.
export function itemMenuItems(
  item: DriveItem,
  actions: RowActions,
  onOpen: () => void,
  onToggleFavorite?: (item: DriveItem) => void,
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void,
): ReactNode {
  const entries = menuEntries(item, {
    share: !!actions.onShare,
    favorite: !!onToggleFavorite,
    partner: !!onTogglePartnerVisible,
    readOnly: !!actions.readOnly,
  });
  const has = (entry: MenuEntry) => entries.includes(entry);
  const canRename = has("rename");
  const canMove = has("move");
  const canDelete = has("delete");
  const canFavorite = has("favorite");
  const canShare = has("share");
  const canTogglePartner = has("partner");
  // Partner visibility toggle: applies to docs and files in project-scoped Drive.
  // partnerVisible lives on the doc/file variant — access it via cast to avoid
  // widening the union type unnecessarily.
  const itemPartnerVisible = (item as { partnerVisible?: boolean | null }).partnerVisible ?? false;
  if (entries.length === 1 && canDelete) {
    return (
      <Menu.Item icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => actions.onDelete(item)}>
        Delete
      </Menu.Item>
    );
  }
  return (
    <>
      <Menu.Item icon={<FolderOpen className="h-3.5 w-3.5" />} onSelect={onOpen}>
        Open
      </Menu.Item>
      <OpenBesideMenuItem item={item} />
      {has("download") && actions.onDownload && (
        <Menu.Item icon={<Download className="h-3.5 w-3.5" />} onSelect={() => actions.onDownload!(item)}>
          Download
        </Menu.Item>
      )}
      {canFavorite && onToggleFavorite && (
        <Menu.Item
          icon={<Star className={`h-3.5 w-3.5 ${item.favorited ? "fill-current text-os-accent" : ""}`} />}
          onSelect={() => onToggleFavorite(item)}
        >
          {item.favorited ? "Remove from favorites" : "Add to favorites"}
        </Menu.Item>
      )}
      {canShare && (
        <Menu.Item icon={<Share2 className="h-3.5 w-3.5" />} onSelect={() => actions.onShare!(item)}>
          Share…
        </Menu.Item>
      )}
      {canTogglePartner && (
        <Menu.Item
          icon={<Handshake className={`h-3.5 w-3.5 ${itemPartnerVisible ? "text-accent-teal" : ""}`} />}
          onSelect={() => onTogglePartnerVisible!(item, !itemPartnerVisible)}
        >
          {itemPartnerVisible ? "Stop sharing with partner" : "Share with partner"}
        </Menu.Item>
      )}
      {item.type === "folder" && isPageFolder(item) && actions.onFolderSettings && actions.canFolderSettings?.(item) && (
        <Menu.Item icon={<SlidersHorizontal className="h-3.5 w-3.5" />} onSelect={() => actions.onFolderSettings!(item)}>
          Folder settings…
        </Menu.Item>
      )}
      {(canRename || canMove) && <Menu.Separator />}
      {canRename && (
        <Menu.Item icon={<Pencil className="h-3.5 w-3.5" />} onSelect={() => actions.onRename(item)}>
          Rename
        </Menu.Item>
      )}
      {canMove && (
        <Menu.Item icon={<FolderInput className="h-3.5 w-3.5" />} onSelect={() => actions.onRequestMove(item)}>
          Move to…
        </Menu.Item>
      )}
      {canDelete && (
        <>
          <Menu.Separator />
          <Menu.Item icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => actions.onDelete(item)}>
            Delete
          </Menu.Item>
        </>
      )}
    </>
  );
}

export function RowActionsMenu({
  item,
  actions,
  onOpen,
  onToggleFavorite,
  onTogglePartnerVisible,
}: {
  item: DriveItem;
  actions: RowActions;
  onOpen: () => void;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
}) {
  return (
    <>
    <OpenBesideButton item={item} />
    <Menu
      align="right"
      ariaLabel="Item actions"
      trigger={
        <button
          type="button"
          data-testid={`drive-item-actions-${item.id}`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      }
    >
      {itemMenuItems(item, actions, onOpen, onToggleFavorite, onTogglePartnerVisible)}
    </Menu>
    </>
  );
}
