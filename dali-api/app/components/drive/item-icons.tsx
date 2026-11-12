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


export type IconSize = "sm" | "lg" | "xl";

export function itemIcon(item: DriveItem, size: IconSize = "sm") {
  return glyphIcon(pickGlyph(item), item, size);
}

export function glyphIcon(glyph: ItemGlyph, item: DriveItem, size: IconSize): ReactNode {
  const cls = size === "xl" ? "w-10 h-10" : size === "lg" ? "w-8 h-8" : "w-4 h-4";
  const markCls = size === "xl" ? "w-3.5 h-3.5" : size === "lg" ? "w-3 h-3" : "w-2.5 h-2.5";
  const emojiCls = `${cls} flex items-center justify-center leading-none shrink-0 ${
    size === "xl" ? "text-3xl" : size === "lg" ? "text-2xl" : "text-sm"
  }`;
  switch (glyph.kind) {
    case "emoji":
      return <span className={emojiCls}>{glyph.emoji}</span>;
    case "folder":
      return <FolderGlyph glyph={glyph} className={cls} markClassName={markCls} />;
    case "notebook": {
      const notebook = <NotebookPen className={`${cls} ${CORAL_FOLDER} shrink-0`} />;
      if (!glyph.tabs) return notebook;
      return (
        <GlyphBadge
          badge={
            <span
              data-testid="notebook-tab-count"
              className={`min-w-3.5 px-0.5 text-center font-semibold leading-3.5 tabular-nums text-muted-foreground ${
                size === "sm" ? "text-[9px]" : "text-[10px]"
              }`}
            >
              {glyph.tabs}
            </span>
          }
        >
          {notebook}
        </GlyphBadge>
      );
    }
    case "file": {
      const Icon = iconForCategory(categorize({ fileName: item.title || "" }));
      return <Icon className={`${cls} text-muted-foreground shrink-0`} />;
    }
    case "form":
      return <ClipboardList className={`${cls} text-muted-foreground shrink-0`} />;
    case "agreement":
      return <FileSignature className={`${cls} text-muted-foreground shrink-0`} />;
    case "rubric":
      return <ClipboardCheck className={`${cls} text-muted-foreground shrink-0`} />;
    case "whiteboard":
      return <Shapes className={`${cls} text-muted-foreground shrink-0`} />;
    case "slides":
      return <Presentation className={`${cls} text-muted-foreground shrink-0`} />;
    case "doc":
      return <FileText className={`${cls} text-muted-foreground shrink-0`} />;
  }
}

/** The row glyph with a hover label saying what the item is and who can see it. */
export function ItemGlyphTip({ item, size }: { item: DriveItem; size?: IconSize }) {
  const label = glyphLabel(pickGlyph(item), {
    audienceLabel: "audience" in item ? item.audience?.label : undefined,
    tabCount: item.type === "doc" ? item.tabCount : undefined,
    itemType: item.type,
    title: item.title,
  });
  return (
    <Tooltip content={label} variant="label" placement="top">
      <span aria-hidden data-testid="item-glyph" className="inline-flex shrink-0">
        {itemIcon(item, size)}
      </span>
    </Tooltip>
  );
}

export function scopeIcon(scope: DriveTreeScope, size: IconSize = "sm") {
  return scopeIconFor(scope, size);
}

export function scopeLabel(scope: DriveTreeScope): string {
  return driveScopeLabel(scope);
}

/** The synthetic "projects" / "education" headers: dropping on one is ambiguous (which project?), so only the projects inside take drops. */
export function isGroupScope(scopeId: string): boolean {
  return scopeId === "projects" || scopeId === "education";
}
