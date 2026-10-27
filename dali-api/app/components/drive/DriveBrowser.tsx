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
import type { DriveItem } from "~/lib/drive.server";
import { listedUnderFilter, matchesTypeFilter, type DriveTypeFilter } from "~/components/drive/type-filter";
import { categorize } from "~/lib/file-type";
import { iconForCategory } from "~/lib/file-icon";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import { Menu, ContextMenu, Tooltip, isInFloatingLayer } from "~/components/ui/floating";
import { useSidePanel } from "~/components/side-panel/use-side-panel";
import { sidePanelForUrl } from "~/lib/side-panel";
import { ShareDialog } from "~/components/sharing/ShareDialog";
import { relativeTime } from "~/lib/relative-time";
import { useRevalidator } from "react-router";
import { useToast } from "~/components/ui/toast";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { notebookRequest, sendJson } from "~/components/notebooks/notebook-requests";
import { cn } from "~/lib/cn";
import { FAVORITES_SPACE_KEY, isProcessRootSpace, SHARED_SPACE_KEY } from "~/lib/drive-spaces";
import { scopeIconFor } from "~/components/drive/scope-icon";
import { ProcessLinkPill } from "~/components/drive/ProcessLinkPill";
import { AudienceSignal } from "~/components/drive/AudienceSignal";
import { TagDots } from "~/components/drive/TagDots";
import { Button, buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Truncated } from "~/components/ui/Truncated";
import { useOsChrome } from "~/components/os-chrome";
import { crumbsFor, driveScopeLabel, locationOf, type ItemLocation } from "~/components/drive/location";
import { LocationLink } from "~/components/drive/LocationLink";
import { menuEntries, type MenuEntry } from "~/components/drive/item-menu";
import { clickIntent } from "~/components/drive/column-click";
import { gridStepBlocks, perRowFromTops, type GridBlock } from "~/components/drive/grid-nav";
import { MarqueeBox, useMarquee } from "~/components/drive/use-marquee";
import { CORAL_FOLDER, glyphLabel, pickGlyph, type ItemGlyph } from "~/components/drive/glyphs";
import { droppedFiles } from "~/components/drive/dropped-files";
import { FolderGlyph, GlyphBadge } from "~/components/drive/FolderGlyph";
import { FolderSettingsModal } from "~/components/drive/FolderSettingsModal";
import { isPageFolder, meetingsOptionFor, receivesLabel } from "~/components/drive/receiver-options";

function useDriveText() {
  return {
    /** Font size for a browser row (.drivepage-node / .drive-file-name: 14px).
     *  A step below the shell's own rows on purpose — a column pane is 200px
     *  wide, and the nav's 16px truncates a filename that reads fine here. */
    row: "text-sm",
    /** Padding + gap shared by list and column item rows so the two views keep
     *  the same line spacing (.drivepage-node: 9px 10px, 10px gap). */
    itemRow: "gap-2.5 px-2.5 py-2",
    /** Secondary metadata beside a row — modified, size, path, kind (12px). */
    meta: "text-xs",
    /** Column headers and other all-caps micro-labels (11px). */
    label: "text-[11px]",
    /** The "Core only" / "Project" row badges. */
    badge: "text-[10px]",
  };
}

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
  /** Open the in-place Share dialog for a page-backed item (doc or folder). */
  onShare?: (item: DriveItem) => void;
  /** Whether forms can be shared (set by the browser from its `formShare` prop). */
  formShare?: boolean;
  /** Apply a tag to the Drive's tag filter (clicking a tag dot). */
  onTagClick?: (tagId: string) => void;
  /** Rename, Move and Delete are left off the item menu (the Shared with me space). */
  readOnly?: boolean;
  /** Open Folder settings for a page folder; `canFolderSettings` says which folders have something to set. */
  onFolderSettings?: (item: DriveItem) => void;
  canFolderSettings?: (item: DriveItem) => boolean;
};

type SortKey = "name" | "modified" | "size" | "shared";
type SortDir = "asc" | "desc";
type ViewMode = "columns" | "list" | "grid";
/** Where the browser is pointed: a drive, and a folder inside it. */
type DriveLocation = { scopeId: string | null; folderId: string | null };

export type DriveBrowserProps = {
  /** Forms follow page access (forms-page-access flag): a form row can be shared like a doc. */
  formShare?: boolean;
  scopes: DriveTreeScope[];
  currentScopeId: string | null;
  currentFolderId: string | null;
  typeFilter: DriveTypeFilter;
  search: string;
  onSearchChange: (q: string) => void;
  onNavigate: (scopeId: string | null, folderId: string | null) => void;
  /** Step the host's browser history. Omitted when the host has none (the project tab keeps its folder in state), and Back / Forward then walk the browser's own trail of visited folders. */
  onHistory?: (delta: -1 | 1) => void;
  /** A row to select and scroll to once, when the browser first shows it (Reveal in Drive). */
  initialSelectedId?: string;
  /** A row to select and scroll to whenever this changes, once it appears in the listing (a freshly created item). */
  revealId?: string;
  onOpenItem: (item: DriveItem) => void;
  /** Open a document in the side panel. Omitted, the browser offers no way to open beside. */
  onOpenBeside?: (item: DriveItem) => void;
  /** Re-file every item into `destFolderId` within the scope it already sits
   *  in. Takes a list because dragging one row of a multi-selection drags the
   *  whole selection, the way Finder and Drive do. */
  onMove: (scopeId: string, items: DriveItem[], destFolderId: string | null) => void;
  getScopeActions: (scopeId: string) => RowActions;
  /** Toggle the viewer's favorite on a page item (doc/folder). */
  onToggleFavorite?: (item: DriveItem) => void;
  /** Delete every item in the set (one confirm, handled by the hub). */
  onBulkDelete?: (items: DriveItem[]) => void;
  /** Move every item in the set to another drive/folder (picker + confirm in the hub). */
  onBulkMove?: (items: DriveItem[]) => void;
  /** Move items from one drive scope to another (confirm + re-scope handled by hub). */
  onMoveToScope?: (sourceScopeId: string, destScopeId: string, items: DriveItem[]) => void;
  /** Upload files dropped from the desktop into the current scope+folder. */
  onUploadFiles?: (files: File[], options?: FileDropOptions) => void;
  filterControl?: ReactNode;
  newMenu?: ReactNode;
  /** Overflow ("…") menu for the toolbar's occasional destinations. Owned by
   *  the hub; sits at the end of the row, right of the search field. */
  overflowMenu?: ReactNode;
  /** Tag chip row, rendered under the toolbar. Owned by the hub. */
  tagChips?: ReactNode;
  /**
   * Keep only items carrying a selected tag. Its *presence* means the filter is
   * on — the hub passes undefined when nothing is selected — so there is no
   * second "active" flag to keep in step with it.
   */
  tagFilter?: (item: DriveItem) => boolean;
  /** Called when the user picks Share for a doc or folder. The browser mounts
   *  the ShareDialog in-place with this item as the target. */
  onShareItem?: (item: DriveItem) => void;
  /** Called with a tag id when a row's tag dot is clicked; the host applies it to its tag filter. */
  onTagClick?: (tagId: string) => void;
  /** Called once when the Share dialog closes after sharing changed, so the
   *  host can reload the listing and refresh each row's audience. */
  onSharingChanged?: () => void;
  /**
   * When set, the browser is locked to the single scope whose id matches this
   * value. Column 0 (the scope list) is suppressed — the user is already inside
   * the scoped context (e.g. the project hub's Drive tab). Every other
   * capability — list/grid/columns, DnD, context menus, multi-select, tags,
   * Share, Trash — works as normal. When absent, `/drive` behaviour is unchanged.
   */
  embeddedScopeId?: string;
  /**
   * Toggle partner visibility for an item (doc or file). When provided, a
   * "Share with partner" / "Stop sharing with partner" option is added to each
   * item's context menu, and partner-visible items show a teal handshake badge.
   * Only shown when `hasActivePartner` is also true — the prop alone is not
   * enough; the caller must pass both.
   */
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
  /** Whether the project has an active partner relationship. Controls whether
   *  the partner-visibility toggle is shown in item menus. */
  hasActivePartner?: boolean;
  /** Turns on "Folder settings…" (where the space's new meeting notebooks file). */
  receiverViewer?: { isCore: boolean; isProjectMember: boolean };
};

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function childrenAt(items: DriveItem[], folderId: string | null): DriveItem[] {
  return items.filter((it) => it.parentFolderId === folderId);
}

function kindLabel(item: DriveItem): string {
  switch (item.type) {
    case "folder":
      return "Folder";
    case "doc":
      return item.isNotebook ? `Notebook · ${item.tabCount ?? 0} ${item.tabCount === 1 ? "tab" : "tabs"}` : "Document";
    case "file":
      return "File";
    case "form":
      return "Form";
    case "rubric":
      return "Rubric";
    default:
      return "Agreement";
  }
}

// Quick Look only has something to show for uploaded images and PDFs. Docs,
// forms, folders and the managed kinds have no inline representation — they open
// in their editor — so the preview affordance is hidden for them rather than
// offering a button that just says "no preview."
function isPreviewable(item: DriveItem): boolean {
  if (item.type !== "file") return false;
  // Drive items carry no content type and their href is the file *page* (not an
  // inline media URL), so Quick Look renders only what an <img>/<iframe> can
  // load from that surface: images and PDFs. Classification is shared; the
  // narrowing to image+pdf is this surface's constraint, not the taxonomy's.
  const cat = categorize({ fileName: item.title || "" });
  return cat === "image" || cat === "pdf";
}

function formatSize(bytes?: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function ms(d: Date): number {
  return new Date(d as unknown as string).getTime();
}

function sharedAtMs(item: DriveItem): number {
  return item.type === "doc" && item.sharedAt ? ms(item.sharedAt) : 0;
}

// Folders always group first; sort within each group by the chosen key.
function sortItems(items: DriveItem[], key: SortKey, dir: SortDir): DriveItem[] {
  const cmp = (a: DriveItem, b: DriveItem) => {
    let r = 0;
    if (key === "name") r = (a.title || "").localeCompare(b.title || "");
    else if (key === "modified") r = ms(a.updatedAt) - ms(b.updatedAt);
    else if (key === "shared") r = sharedAtMs(a) - sharedAtMs(b);
    else r = (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
    if (r === 0) r = (a.title || "").localeCompare(b.title || "");
    return dir === "asc" ? r : -r;
  };
  const folders = items.filter((i) => i.type === "folder").sort(cmp);
  const rest = items.filter((i) => i.type !== "folder").sort(cmp);
  return [...folders, ...rest];
}

export type SearchHit = { scope: DriveTreeScope; item: DriveItem; path: string; location: ItemLocation };

export function searchAll(
  scopes: DriveTreeScope[],
  q: string,
  typeFilter: DriveBrowserProps["typeFilter"],
  tagFilter?: (item: DriveItem) => boolean,
): SearchHit[] {
  const needle = q.trim().toLowerCase();
  // Tags alone are a valid query: "everything tagged X, anywhere in the Drive"
  // is the thing the old documents hub could answer and the tree can't.
  if (!needle && !tagFilter) return [];
  const hits: SearchHit[] = [];
  for (const scope of scopes) {
    for (const item of scope.items) {
      if (!matchesTypeFilter(item, typeFilter)) continue;
      if (needle && !(item.title || "").toLowerCase().includes(needle)) continue;
      if (tagFilter && !tagFilter(item)) continue;
      const location = locationOf(scope, item.parentFolderId);
      hits.push({ scope, item, path: location.path, location });
    }
  }
  return hits.sort((a, b) => (a.item.title || "").localeCompare(b.item.title || ""));
}

function folderDescendants(items: DriveItem[], folderId: string): Set<string> {
  const childMap = new Map<string, string[]>();
  for (const it of items) {
    if (it.type !== "folder") continue;
    const p = it.parentFolderId ?? "_root_";
    const list = childMap.get(p);
    if (list) list.push(it.id);
    else childMap.set(p, [it.id]);
  }
  const out = new Set([folderId]);
  const queue = [folderId];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const c of childMap.get(cur) ?? []) if (!out.has(c)) (out.add(c), queue.push(c));
  }
  return out;
}

// ── Icons ────────────────────────────────────────────────────────────────────

type IconSize = "sm" | "lg" | "xl";

export function itemIcon(item: DriveItem, size: IconSize = "sm") {
  return glyphIcon(pickGlyph(item), item, size);
}

function glyphIcon(glyph: ItemGlyph, item: DriveItem, size: IconSize): ReactNode {
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
function ItemGlyphTip({ item, size }: { item: DriveItem; size?: IconSize }) {
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

function scopeIcon(scope: DriveTreeScope, size: IconSize = "sm", tiles = false) {
  return scopeIconFor(scope, size, tiles);
}

function scopeLabel(scope: DriveTreeScope): string {
  return driveScopeLabel(scope);
}

/** The synthetic "projects" / "education" headers: dropping on one is ambiguous (which project?), so only the projects inside take drops. */
function isGroupScope(scopeId: string): boolean {
  return scopeId === "projects" || scopeId === "education";
}

/** A drive as a drop target: dropping items on it re-scopes them. Shared by the columns, the list and the grid. */
function useScopeDrop(scopeId: string, dragging: boolean) {
  return useDroppable({
    id: `scopedrop::${scopeId}`,
    data: { destScopeId: scopeId },
    disabled: !dragging || isGroupScope(scopeId),
  });
}

type BesideState = { open: ((item: DriveItem) => void) | null; activeId: string | null };
const BesideContext = createContext<BesideState>({ open: null, activeId: null });

function besideTarget(item: DriveItem) {
  return item.type === "doc" ? sidePanelForUrl(item.href) : null;
}

/** How a row opens beside: an opener when it can, and whether it is the document showing in the panel now. */
function useBeside(item: DriveItem) {
  const { open, activeId } = useContext(BesideContext);
  const target = open ? besideTarget(item) : null;
  return { openBeside: target && open ? () => open(item) : null, active: !!target && activeId === target.id };
}

function BesideMark({ item }: { item: DriveItem }) {
  const { active } = useBeside(item);
  if (!active) return null;
  return <span className="shrink-0 rounded-full bg-os-container px-2 py-0.5 text-xs font-medium text-os-accent">Open beside</span>;
}

function OpenBesideButton({ item }: { item: DriveItem }) {
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

function OpenBesideMenuItem({ item }: { item: DriveItem }) {
  const { openBeside } = useBeside(item);
  if (!openBeside) return null;
  return (
    <Menu.Item icon={<PanelRight className="h-3.5 w-3.5" />} shortcut="⌥ click" onSelect={openBeside}>
      Open to the side
    </Menu.Item>
  );
}

// Menu.Item nodes shared by the row "⋯" dropdown and the right-click menu.
function itemMenuItems(
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
    formShare: !!actions.formShare,
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

function RowActionsMenu({
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


/** Give the keyboard to the pane a row sits in, so arrows and shortcuts work without a second click. */
function focusPane(el: Element) {
  el.closest<HTMLElement>("[data-drive-pane]")?.focus({ preventScroll: true });
}

const GRID_COLUMNS = "minmax(0,1fr) 9rem 5rem 3.75rem";
/** Flat listings (search, tag and type results) trade Size for where the item lives. */
const GRID_COLUMNS_FLAT = "minmax(0,1fr) minmax(0,16rem) 5rem 2rem";
const SHARED_GRID_COLUMNS = "minmax(0,1fr) 9rem 9rem 5rem 3.75rem";

/** Icon-view geometry, shared by the drive tiles and the item tiles. Fixed cell
 *  width (not `1fr`) so a sparse row doesn't stretch one tile across the pane —
 *  Finder-style: the icon is the object, the caption sits under it. */
const GRID_CONTAINER =
  "grid grid-cols-[repeat(auto-fill,minmax(5.75rem,5.75rem))] justify-start gap-x-2 gap-y-3 px-3 py-3";
const GRID_TILE =
  "group relative flex flex-col items-center gap-1 rounded-lg px-0.5 py-2 text-center cursor-default select-none";
function isNotebookItem(item: DriveItem): boolean {
  return item.type === "doc" && !!item.isNotebook;
}

function isPlainDocument(item: DriveItem): boolean {
  return item.type === "doc" && !item.isNotebook && !item.isWhiteboard && !item.isSlides;
}

function acceptsDrops(item: DriveItem): boolean {
  return item.type === "folder" || isNotebookItem(item);
}

function dropData(item: DriveItem, scopeId: string | null) {
  const destScopeId = scopeId ?? undefined;
  return isNotebookItem(item)
    ? { destNotebookId: item.id, destScopeId }
    : { destFolderId: item.id, destScopeId };
}

/** Where a drop of OS files lands when it is not on the current folder: the folder under the pointer. */
export type FileDropOptions = { folderId?: string; skippedFolders?: number };

const FILE_DROP_ATTR = "data-file-drop-folder";

/** The folder row or tile under a drag event's target, if any. */
function fileDropFolderAt(e: React.DragEvent): string | null {
  const el = e.target instanceof Element ? e.target.closest(`[${FILE_DROP_ATTR}]`) : null;
  return el?.getAttribute(FILE_DROP_ATTR) ?? null;
}

/** The folder a dragged OS file is hovering, so its row or tile can light up. */
const FileDropContext = createContext<string | null>(null);

/** Marks a folder as an upload target for dropped OS files and says whether a file drag is on it now. */
function useFileDropFolder(item: DriveItem) {
  const over = useContext(FileDropContext) === item.id;
  const attrs = item.type === "folder" ? { [FILE_DROP_ATTR]: item.id } : {};
  return { over, attrs };
}

/** What a row, tile, card or crumb looks like while a dragged item hovers it as a drop target; one look in every view. */
export const DROP_RING = "bg-os-accent/10 ring-2 ring-inset ring-os-accent";
export const DROP_OVERLAY =
  "pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-os-card border-2 border-dashed border-os-accent bg-os-accent/10";

/** Caption under a grid icon — always smaller than the artwork, even under os. */
const GRID_LABEL = "max-w-full truncate rounded px-1.5 py-0.5 text-xs font-medium";

// ── Miller column types ──────────────────────────────────────────────────────

// Each "level" in the column stack is either the scope root or a folder inside
// a scope. The column renders that level's children.
type ColumnLevel =
  | { kind: "root" }
  | { kind: "scope"; scopeId: string; folderId: string | null };

/**
 * The column stack for a location:
 *   Col 0: all scopes
 *   Col 1: the scope's top level
 *   Col k: the children of the (k-1)th folder crumb
 * so a column's open row is the folder the next column shows (see `openRowIdAt`).
 */
function columnLevels(
  currentScopeId: string | null,
  currentFolderId: string | null,
  scopes: DriveTreeScope[],
): ColumnLevel[] {
  const scope = currentScopeId ? scopes.find((s) => s.id === currentScopeId) : undefined;
  if (!currentScopeId || !scope) return [{ kind: "root" }];
  const levels: ColumnLevel[] = [
    { kind: "root" },
    { kind: "scope", scopeId: currentScopeId, folderId: null },
  ];
  for (const crumb of crumbsFor(scope.items, currentFolderId)) {
    levels.push({ kind: "scope", scopeId: currentScopeId, folderId: crumb.id });
  }
  return levels;
}

/** The row a column has open: the scope for column 0, else the folder whose children the next column shows. */
function openRowIdAt(levels: ColumnLevel[], levelIdx: number): string | null {
  const next = levels[levelIdx + 1];
  if (!next || next.kind !== "scope") return null;
  return levelIdx === 0 ? next.scopeId : next.folderId;
}

// ── Main component ───────────────────────────────────────────────────────────

export function DriveBrowser({
  scopes,
  currentScopeId,
  currentFolderId,
  typeFilter,
  search,
  onSearchChange,
  onNavigate,
  onHistory,
  initialSelectedId,
  revealId,
  onOpenItem,
  onOpenBeside,
  onMove,
  getScopeActions,
  onToggleFavorite,
  onBulkDelete,
  onBulkMove,
  onMoveToScope,
  onUploadFiles,
  filterControl,
  newMenu,
  overflowMenu,
  tagChips,
  tagFilter,
  onShareItem,
  onTagClick,
  onSharingChanged,
  formShare = false,
  embeddedScopeId,
  onTogglePartnerVisible,
  hasActivePartner,
  receiverViewer,
}: DriveBrowserProps) {
  const currentScope = useMemo(
    () => scopes.find((s) => s.id === currentScopeId) ?? null,
    [scopes, currentScopeId],
  );

  // Share dialog state — the item currently targeted for in-place sharing.
  const [shareTarget, setShareTarget] = useState<{ id: string; title: string; workspaceType: string } | null>(null);
  const sharingChangedRef = useRef(false);
  const revalidator = useRevalidator();
  const toast = useToast();

  async function dropOnNotebook(notebook: DriveItem, dragged: DriveItem[]) {
    if (!dragged.every(isPlainDocument)) {
      toast.error("Only documents can go in a notebook.");
      return;
    }
    const results = await Promise.all(
      dragged.map((d) => sendJson(notebookRequest(notebook.id, { intent: "add-page", pageId: d.id }))),
    );
    const failed = results.find((r) => !r.ok);
    if (failed) toast.error(failed.error ?? "Something went wrong");
    if (results.some((r) => r.ok)) {
      toast.success(`Added to ${notebook.title}`);
      void revalidator.revalidate();
    }
  }

  const [folderSettings, setFolderSettings] = useState<{ item: DriveItem; scopeId: string } | null>(null);

  function meetingsOptionIn(scopeId: string, folderId: string) {
    if (!receiverViewer) return null;
    const scope = scopes.find((sc) => sc.id === scopeId);
    return meetingsOptionFor({
      scopeId,
      scopeLabel: scope?.label ?? "",
      items: scope?.items ?? [],
      folderId,
      ...receiverViewer,
    });
  }

  // Wrap the hub's getScopeActions to inject the in-place Share handler.
  // Sharing only applies to doc/folder (Page-backed) items; the wrapper passes
  // onShare so itemMenuItems and the leaf toolbar can show it without the hub
  // needing to know the browser owns the ShareDialog state.
  function getInternalScopeActions(scopeId: string): RowActions {
    const base = getScopeActions(scopeId);
    // A menu on a row that is part of a multi-selection acts on the selection.
    const inSelection = (item: DriveItem) => selected.has(item.id) && selectedItems.length > 1;
    return {
      ...base,
      formShare,
      onDelete: (item: DriveItem) =>
        inSelection(item) && onBulkDelete ? onBulkDelete(selectedItems) : base.onDelete(item),
      onRequestMove: (item: DriveItem) =>
        inSelection(item) && onBulkMove ? onBulkMove(selectedItems) : base.onRequestMove(item),
      ...(onTagClick ? { onTagClick } : {}),
      ...(receiverViewer
        ? {
            onFolderSettings: (item: DriveItem) => setFolderSettings({ item, scopeId }),
            canFolderSettings: (item: DriveItem) => meetingsOptionIn(scopeId, item.id) !== null,
          }
        : {}),
      onShare: (item: DriveItem) => {
        if (item.type !== "doc" && item.type !== "folder" && !(item.type === "form" && formShare)) return;
        // workspaceType is not on DriveItem directly; infer from the scope id
        // so the ShareDialog can show the correct audience label (Lab/Project/Member).
        const scope = scopes.find((s) => s.id === scopeId);
        // Only a hint: the dialog replaces it with the server's answer once
        // loaded. Still worth getting right — education pages are not Project
        // ones, and the fallback claimed they were.
        const wt =
          !scope || scope.id === "lab" || isProcessRootSpace(scope.id)
            ? "Lab"
            : scope.id === "mine"
              ? "Member"
              : scope.id === "education"
                ? "EducationOffering"
                : "Project";
        setShareTarget({ id: item.id, title: item.title || "Untitled", workspaceType: wt });
        onShareItem?.(item);
      },
    };
  }

  // ── Selection state ────────────────────────────────────────────────────────
  // One model for every view. `selected` is what bulk actions apply to,
  // `anchorId` is where a shift-click range starts, and `focusId` is the row the
  // keyboard, Quick Look and rename talk about: the last one clicked, checked
  // or arrowed to.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  const [viewMode, setViewMode] = useState<ViewMode>("columns");
  useEffect(() => {
    setSort((prev) =>
      currentScopeId === SHARED_SPACE_KEY
        ? { key: "shared", dir: "desc" }
        : prev.key === "shared"
          ? { key: "name", dir: "asc" }
          : prev,
    );
  }, [currentScopeId]);
  // Search rests collapsed as a round icon button; focus (or a query already in
  // the box) stretches it into a field.
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Item queued for the spacebar Quick Look overlay (null = closed).
  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null);
  const [uploadOver, setUploadOver] = useState(false);
  const [fileOverFolder, setFileOverFolder] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<{ item: DriveItem; scopeId: string } | null>(null);
  const dragDepth = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Visited locations, oldest first, with `cursor` marking where in that trail
  // the browser currently sits — the state behind the toolbar's < > pair.
  const historyRef = useRef<DriveLocation[]>([
    { scopeId: currentScopeId, folderId: currentFolderId },
  ]);
  const [cursor, setCursor] = useState(0);

  // ── Miller column state ────────────────────────────────────────────────────
  // The stack is layout only. Which row is open in a column follows from it
  // (see openRowIdAt), and it is rebuilt from the URL whenever the location
  // changes, so navigation is the one thing that ever truncates it.
  const [levels, setLevels] = useState<ColumnLevel[]>(() =>
    columnLevels(currentScopeId, currentFolderId, scopes),
  );
  const columnsContainerRef = useRef<HTMLDivElement | null>(null);
  // Which column the keyboard drives: up/down move within it, left/right step
  // between columns.
  const [focusLevel, setFocusLevel] = useState(() => Math.max(0, levels.length - 1));
  // Type-ahead buffer: consecutive letters within a second jump to the first row
  // in the focused pool whose name starts with them.
  const typeAhead = useRef<{ buf: string; at: number }>({ buf: "", at: 0 });

  // Restore the saved view mode after mount.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("dali_drive_view");
      if (saved === "grid") setViewMode("grid");
      else if (saved === "list") setViewMode("list");
      // default stays "columns"
    } catch {
      /* ignore */
    }
  }, []);

  function changeView(v: ViewMode) {
    setViewMode(v);
    setLevels(columnLevels(currentScopeId, currentFolderId, scopes));
    try {
      window.localStorage.setItem("dali_drive_view", v);
    } catch {
      /* ignore */
    }
  }

  // Rebuild the columns when the URL-driven location changes (breadcrumb click,
  // back/forward, programmatic navigate). Not on `scopes`: a revalidation must
  // not snap the layout out from under the pointer.
  useEffect(() => {
    const next = columnLevels(currentScopeId, currentFolderId, scopes);
    setLevels(next);
    setFocusLevel((prev) => Math.min(prev, Math.max(0, next.length - 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScopeId, currentFolderId]);

  // Auto-scroll the columns container to the right after each column is added.
  useEffect(() => {
    const el = columnsContainerRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [levels.length]);

  // Follow the keyboard: bring the focused row into view (horizontally as well,
  // since a deep trail scrolls the columns off-screen).
  useEffect(() => {
    if (!focusId) return;
    const id = CSS.escape(focusId);
    rootRef.current
      ?.querySelector(`[data-row-id="${id}"], [data-item-id="${id}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusId]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const suppressClickRef = useRef(false);
  /** The click that ends a drag (a row drag or a marquee) must not select, open or deselect anything. */
  function suppressNextClick() {
    suppressClickRef.current = true;
    setTimeout(() => (suppressClickRef.current = false), 0);
  }
  /** True once, for the click that ends a drag: whatever it landed on should ignore it. */
  function consumeSuppressedClick(): boolean {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  }

  // "searching" is really "showing flat results across every drive", which a
  // tag selection does just as much as a text query — the tree can't express
  // "tagged X" the way a folder path expresses location.
  const searching = search.trim().length > 0 || !!tagFilter;
  const columnsActive = viewMode === "columns" && !searching;
  const searchExpanded = searchFocused || search.length > 0;
  const hits = useMemo(
    () => (searching ? searchAll(scopes, search, typeFilter, tagFilter) : []),
    [searching, scopes, search, typeFilter, tagFilter],
  );

  const folderCrumbs = currentScope ? crumbsFor(currentScope.items, currentFolderId) : [];

  const listing = useMemo(() => {
    if (!currentScope) return [];
    const kids = childrenAt(currentScope.items, currentFolderId).filter(
      (it) => listedUnderFilter(it, typeFilter),
    );
    return sortItems(kids, sort.key, sort.dir);
  }, [currentScope, currentFolderId, typeFilter, sort]);

  /** Row order of the list, grid and search views (columns order rows per column). */
  const orderedIds = useMemo(() => {
    if (searching) return hits.map((h) => h.item.id);
    if (!currentScope) return scopes.map((s) => s.id);
    return listing.map((i) => i.id);
  }, [searching, hits, currentScope, scopes, listing]);

  // Every item the current view shows, with the drive it belongs to: the open
  // columns, the listing, or the search hits. Selection, focus and the details
  // rail are all resolved through it.
  const itemIndex = useMemo(() => {
    const index = new Map<string, { item: DriveItem; scopeId: string }>();
    if (searching) {
      for (const h of hits) index.set(h.item.id, { item: h.item, scopeId: h.scope.id });
    } else if (columnsActive) {
      for (const level of levels) {
        const scopeId = scopeIdForLevel(level);
        if (!scopeId) continue;
        for (const item of itemsForLevel(level)) index.set(item.id, { item, scopeId });
      }
    } else if (currentScope) {
      for (const item of listing) index.set(item.id, { item, scopeId: currentScope.id });
    }
    return index;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, hits, columnsActive, levels, currentScope, listing, scopes, typeFilter, sort]);

  const selectedItems = useMemo(
    () => [...itemIndex.values()].filter((e) => selected.has(e.item.id)).map((e) => e.item),
    [itemIndex, selected],
  );

  // The drives themselves are focusable (arrow keys walk them) but never selected.
  const scopesFocusable = !searching && (columnsActive || !currentScope);

  // Whatever the view stops showing — a folder left behind, a view switch, a
  // search, an item deleted elsewhere — drops out of the selection, anchor and
  // focus; what is still on screen keeps them.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => itemIndex.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setAnchorId((a) => (a && itemIndex.has(a) ? a : null));
    setFocusId((f) =>
      f && (itemIndex.has(f) || (scopesFocusable && scopes.some((s) => s.id === f))) ? f : null,
    );
  }, [itemIndex, scopesFocusable, scopes]);

  const focusEntry = focusId ? (itemIndex.get(focusId) ?? null) : null;

  // Arriving somewhere new leaves behind whatever was picked elsewhere: only
  // rows of the destination's own listing (the keyboard's first-row pick on
  // stepping into a column) survive. Declared before the reveal effect below
  // so a reveal's selection lands after this and wins.
  useEffect(() => {
    const here = new Set(listing.map((i) => i.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => here.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setAnchorId((a) => (a && here.has(a) ? a : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScopeId, currentFolderId]);

  // Reveal in Drive lands here with the item to show: select it on first
  // mount only (a later folder that happens to hold it is not a reveal), and
  // the focus effect above scrolls it into view.
  const revealedRef = useRef(false);
  useEffect(() => {
    if (!initialSelectedId || revealedRef.current) return;
    revealedRef.current = true;
    if (!itemIndex.has(initialSelectedId)) return;
    focusOnly(initialSelectedId);
    const level = levelIndexOf(initialSelectedId);
    if (level > 0) setFocusLevel(level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedId, itemIndex]);

  const revealedIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!revealId || revealedIdRef.current === revealId || !itemIndex.has(revealId)) return;
    revealedIdRef.current = revealId;
    focusOnly(revealId);
    const level = levelIndexOf(revealId);
    if (level > 0) setFocusLevel(level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealId, itemIndex]);

  // ── Selection ──────────────────────────────────────────────────────────────
  function clearSelection() {
    setSelected(new Set());
    setAnchorId(null);
    setFocusId(null);
  }

  /** Focus this row and select it alone, or with `selectable` false just focus it (clearing the selection). Drives take focus but never selection. */
  function focusOnly(id: string, selectable = true) {
    setSelected(selectable ? new Set([id]) : new Set());
    setAnchorId(selectable ? id : null);
    setFocusId(id);
  }

  /** The marquee's result: replace the selection, focusing the last row it reached. */
  function selectIds(ids: string[]) {
    setSelected(new Set(ids));
    setAnchorId(ids[0] ?? null);
    setFocusId(ids[ids.length - 1] ?? null);
  }

  function levelIndexOf(id: string): number {
    return columnsActive
      ? levels.findIndex((level) => itemsForLevel(level).some((i) => i.id === id))
      : -1;
  }

  /** The rows a shift-click range runs across: the clicked row's own column, or the whole listing. */
  function poolIdsFor(id: string): string[] {
    if (!columnsActive) return orderedIds;
    const level = levels[levelIndexOf(id)];
    return level ? itemsForLevel(level).map((i) => i.id) : [];
  }

  function selectWithModifier(id: string, mode: "toggle" | "range", poolIds: string[]) {
    if (mode === "toggle") {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setAnchorId(id);
    } else {
      const a = poolIds.indexOf(anchorId!);
      const b = poolIds.indexOf(id);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      setSelected(new Set(poolIds.slice(lo, hi + 1)));
    }
    setFocusId(id);
    const level = levelIndexOf(id);
    if (level > 0) setFocusLevel(level);
  }

  /** A click on a row, tile or card: plain selects it alone, cmd/ctrl toggles, shift extends; a tap opens. */
  function handleRowClick(id: string, e: ReactMouseEvent<HTMLElement>) {
    // A row's own menu renders in a portal but its clicks still bubble here.
    if (isInFloatingLayer(e.target)) return;
    const altItem = e.altKey && onOpenBeside ? itemIndex.get(id)?.item : undefined;
    if (altItem && besideTarget(altItem)) {
      e.stopPropagation();
      e.preventDefault();
      onOpenBeside!(altItem);
      return;
    }
    const poolIds = poolIdsFor(id);
    const intent = clickIntent({
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      anchorInPool: !!anchorId && poolIds.includes(anchorId),
      suppressed: suppressClickRef.current,
      touch: (e.nativeEvent as Partial<PointerEvent>).pointerType === "touch",
    });
    e.stopPropagation();
    if (intent === "ignore") {
      suppressClickRef.current = false;
      return;
    }
    focusPane(e.currentTarget);
    if (intent === "toggle" || intent === "range") {
      selectWithModifier(id, intent, poolIds);
      return;
    }
    const level = levelIndexOf(id);
    if (level > 0) setFocusLevel(level);
    // A drive at the root, and a folder in the columns, open on the click
    // itself: Finder shows a folder's contents in the next column as soon as
    // it is picked. Everything else waits for a double-click.
    const entry = itemIndex.get(id);
    if (intent === "open" || !entry || (columnsActive && entry.item.type === "folder")) {
      focusOnly(id, false);
      openById(id);
      return;
    }
    focusOnly(id);
  }

  /** A double-click opens: a document in its editor, a folder as the location. */
  function handleRowDoubleClick(id: string, e: ReactMouseEvent<HTMLElement>) {
    if (isInFloatingLayer(e.target)) return;
    e.stopPropagation();
    const level = levelIndexOf(id);
    if (level > 0) setFocusLevel(level);
    focusOnly(id, false);
    openById(id);
  }

  /** Right-click: focus the row, and select it alone unless it is already part of the selection. */
  function handleContextSelect(id: string) {
    setFocusId(id);
    if (!selected.has(id)) {
      setSelected(new Set([id]));
      setAnchorId(id);
    }
    const level = levelIndexOf(id);
    if (level > 0) setFocusLevel(level);
  }

  // ── Open / navigate ──────────────────────────────────────────────────────
  function openById(id: string) {
    const entry = itemIndex.get(id);
    if (!entry) {
      if (!currentScope && scopes.some((s) => s.id === id)) onNavigate(id, null);
      return;
    }
    if (entry.item.type !== "folder") {
      onOpenItem(entry.item);
    } else if (columnsActive) {
      openFolderInColumn(levelIndexOf(id), entry.scopeId, id);
    } else {
      onNavigate(entry.scopeId, id);
    }
  }

  /** Show a folder's (or a drive's) contents in the next column straight away, and navigate there. */
  function openFolderInColumn(levelIdx: number, scopeId: string, folderId: string | null) {
    setLevels((prev) => [...prev.slice(0, levelIdx + 1), { kind: "scope", scopeId, folderId }]);
    onNavigate(scopeId, folderId);
  }

  // ── Up one level ──────────────────────────────────────────────────────────
  //
  // ⌘↑ / Backspace in every view, as in Finder. A drive's top level goes up to
  // the list of drives.
  function goUp() {
    if (!currentScope) return;
    if (currentFolderId) {
      const parent =
        currentScope.items.find((i) => i.id === currentFolderId)?.parentFolderId ?? null;
      onNavigate(currentScope.id, parent);
    } else {
      onNavigate(null, null);
    }
  }

  // ── Back / forward (Finder's < > pair) ────────────────────────────────────
  //
  // Without a host history (the project tab keeps its folder in state) the pair
  // walks a trail of visited locations kept here, and greys a direction out when
  // the trail has nowhere to go. Arriving at a location that is already the
  // neighbouring entry is treated as a step along the trail, so the forward
  // branch survives it; anything else starts a new branch from here.
  useEffect(() => {
    const trail = historyRef.current;
    const at = (l?: DriveLocation) =>
      !!l && l.scopeId === currentScopeId && l.folderId === currentFolderId;
    if (at(trail[cursor])) return;
    if (at(trail[cursor - 1])) return setCursor(cursor - 1);
    if (at(trail[cursor + 1])) return setCursor(cursor + 1);
    historyRef.current = [
      ...trail.slice(0, cursor + 1),
      { scopeId: currentScopeId, folderId: currentFolderId },
    ];
    setCursor(historyRef.current.length - 1);
  }, [currentScopeId, currentFolderId, cursor]);

  // The browser's own history reaches places this trail never saw (the page
  // before the Drive, entries after a reload), so with a host history the pair
  // stays enabled rather than greying out a direction that would still work.
  const canGoBack = !!onHistory || cursor > 0;
  const canGoForward = !!onHistory || cursor < historyRef.current.length - 1;

  function goHistory(delta: -1 | 1) {
    if (onHistory) {
      onHistory(delta);
      return;
    }
    const target = historyRef.current[cursor + delta];
    if (!target) return;
    setCursor(cursor + delta);
    onNavigate(target.scopeId, target.folderId);
  }

  // ── Keyboard navigation (every view) ──────────────────────────────────────

  /** The rows up/down, select-all and type-ahead move through. Drives are walked but not selectable. */
  function keyboardRows(): { rows: { id: string; title: string }[]; selectable: boolean } {
    if (searching) {
      return { rows: hits.map((h) => ({ id: h.item.id, title: h.item.title || "" })), selectable: true };
    }
    if (columnsActive) return { rows: levelRows(focusLevel), selectable: focusLevel > 0 };
    if (!currentScope) return { rows: scopes.map((s) => ({ id: s.id, title: s.label })), selectable: false };
    return { rows: listing.map((i) => ({ id: i.id, title: i.title || "" })), selectable: true };
  }

  /** Delete trashes the whole selection (one confirm via the bulk path), or the one row when only one is picked. */
  function deleteSelection() {
    if (selectedItems.length > 1) {
      onBulkDelete?.(selectedItems);
      return;
    }
    const entry = selectedItems.length === 1 ? itemIndex.get(selectedItems[0].id) : focusEntry;
    if (entry) getInternalScopeActions(entry.scopeId).onDelete(entry.item);
  }

  /** Columns: step into the focused drive or folder (opening its column if it is not already) and focus its first row. */
  function stepIntoFocus({ openFiles }: { openFiles: boolean }) {
    if (!focusId) return;
    let target: { scopeId: string; folderId: string | null } | null = null;
    if (focusLevel === 0) {
      target = { scopeId: focusId, folderId: null };
    } else if (focusEntry?.item.type === "folder") {
      target = { scopeId: focusEntry.scopeId, folderId: focusId };
    } else if (focusEntry && openFiles) {
      onOpenItem(focusEntry.item);
    }
    if (!target) return;
    if (openRowIdAt(levels, focusLevel) !== focusId) {
      openFolderInColumn(focusLevel, target.scopeId, target.folderId);
    }
    setFocusLevel(focusLevel + 1);
    const first = itemsForLevel({ kind: "scope", ...target })[0];
    if (first) focusOnly(first.id);
    else clearSelection();
  }

  /** Columns: step back to the parent column, on the folder that is open in it. */
  function stepOutOfFocusLevel() {
    if (focusLevel === 0) return;
    const parentLevel = focusLevel - 1;
    const openId = openRowIdAt(levels, parentLevel);
    setFocusLevel(parentLevel);
    if (openId) focusOnly(openId, parentLevel > 0);
  }

  /** Each run of tiles that wraps together in the grid view, with how many fit on a row at the current width. */
  function gridBlocks(): GridBlock[] {
    const blocks = listRef.current?.querySelectorAll<HTMLElement>("[data-grid-block]") ?? [];
    return Array.from(blocks, (block) => {
      const tiles = Array.from(block.children) as HTMLElement[];
      return { count: tiles.length, perRow: perRowFromTops(tiles.map((tile) => tile.offsetTop)) };
    });
  }

  function onPaneKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (isInFloatingLayer(e.target)) return;
    if ((e.target as Element).closest("input, textarea, select, [contenteditable='true']")) return;
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === "Backspace" || (mod && e.key === "ArrowUp")) {
      e.preventDefault();
      goUp();
      return;
    }
    if (e.key === "Escape") {
      if (previewItem) {
        setPreviewItem(null);
        return;
      }
      clearSelection();
      return;
    }

    const { rows, selectable } = keyboardRows();
    if (mod && e.key.toLowerCase() === "a") {
      if (!selectable) return;
      e.preventDefault();
      setSelected(new Set(rows.map((r) => r.id)));
      return;
    }
    if (e.key === "Delete" || e.key === "#") {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (e.key === "F2") {
      if (focusEntry) getInternalScopeActions(focusEntry.scopeId).onRename(focusEntry.item);
      return;
    }
    // Space → Quick Look of the focused item, but only for items that actually
    // preview. Must come before type-ahead, which would otherwise swallow it.
    if (e.key === " ") {
      if (focusEntry && isPreviewable(focusEntry.item)) {
        e.preventDefault();
        setPreviewItem(focusEntry.item);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (columnsActive) stepIntoFocus({ openFiles: true });
      else if (focusId) openById(focusId);
      return;
    }

    const idx = focusId ? rows.findIndex((r) => r.id === focusId) : -1;
    const step = (delta: 1 | -1) => {
      if (rows.length === 0) return;
      e.preventDefault();
      const next = idx === -1 ? 0 : Math.min(Math.max(idx + delta, 0), rows.length - 1);
      focusOnly(rows[next].id, selectable);
    };
    const inGrid = viewMode === "grid" && !searching;
    /** In a grid, up and down move a whole visual row; anywhere else, one row. */
    const stepVertically = (delta: 1 | -1) => {
      const blocks = inGrid ? gridBlocks() : [];
      if (rows.length === 0 || blocks.reduce((n, b) => n + b.count, 0) !== rows.length) return step(delta);
      e.preventDefault();
      focusOnly(rows[gridStepBlocks(blocks, idx, delta)].id, selectable);
    };
    if (e.key === "ArrowDown") return stepVertically(1);
    if (e.key === "ArrowUp") return stepVertically(-1);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      if (columnsActive) {
        e.preventDefault();
        if (e.key === "ArrowRight") stepIntoFocus({ openFiles: false });
        else stepOutOfFocusLevel();
      } else if (inGrid) {
        step(e.key === "ArrowRight" ? 1 : -1);
      }
      return;
    }

    // Type-ahead. Single printable characters only, so it never swallows a
    // shortcut; the buffer resets after a second of silence.
    if (e.key.length === 1 && !mod && !e.altKey) {
      const now = Date.now();
      const buf = (now - typeAhead.current.at > 1000 ? "" : typeAhead.current.buf) + e.key.toLowerCase();
      typeAhead.current = { buf, at: now };
      const hit = rows.find((r) => r.title.toLowerCase().startsWith(buf));
      if (hit) {
        e.preventDefault();
        focusOnly(hit.id, selectable);
      }
    }
  }

  // ── dnd-kit (internal move) ──────────────────────────────────────────────
  function handleDragStart(e: DragStartEvent) {
    const data = e.active.data.current as { item: DriveItem; scopeId: string } | undefined;
    setActiveDrag(data ?? null);
  }
  /**
   * Dragging a row that's part of a multi-selection drags the whole selection,
   * the way Finder and Drive do; moving only the row under the cursor silently
   * drops the other items the user had picked. A search selection can span
   * scopes and a move is scope-relative, so only those sharing the dragged
   * row's scope come along.
   */
  function draggedItemsFor(src: { item: DriveItem; scopeId: string }): DriveItem[] {
    if (!selected.has(src.item.id) || selectedItems.length < 2) return [src.item];
    const items = searching
      ? hits.filter((h) => h.scope.id === src.scopeId && selected.has(h.item.id)).map((h) => h.item)
      : selectedItems;
    return items.length > 1 ? items : [src.item];
  }
  function handleDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    suppressNextClick();
    const src = e.active.data.current as { item: DriveItem; scopeId: string } | undefined;
    const dest = e.over?.data.current as
      | { destFolderId?: string | null; destNotebookId?: string; destScopeId?: string }
      | undefined;
    if (!src || !dest) return;
    const dragged = draggedItemsFor(src);
    if (dest.destNotebookId) {
      const notebook = scopes.flatMap((sc) => sc.items).find((it) => it.id === dest.destNotebookId);
      if (notebook && !dragged.some((d) => d.id === notebook.id)) void dropOnNotebook(notebook, dragged);
      return;
    }
    // Cross-drive drop: item dragged onto a scope row in column 0.
    if (dest.destScopeId && dest.destFolderId === undefined) {
      if (dest.destScopeId !== src.scopeId) {
        onMoveToScope?.(src.scopeId, dest.destScopeId, dragged);
      }
      return;
    }
    // Folder-drop: same-drive internal move. The scope comes from the drop
    // target rather than the browsed URL — a column row knows which drive it
    // belongs to, and the browsed scope can lag a drop made in a column that
    // was opened before the last navigation.
    const destScopeId = dest.destScopeId ?? currentScope?.id ?? null;
    if (!destScopeId) return;
    if (destScopeId !== src.scopeId) {
      onMoveToScope?.(src.scopeId, destScopeId, dragged);
      return;
    }
    const destScope = scopes.find((sc) => sc.id === destScopeId);
    if (!destScope) return;
    // Drop the items the destination can't accept rather than failing the whole
    // drag: a folder can't land inside its own subtree, and an item already in
    // the target folder has nowhere to go.
    const movable = dragged.filter((item) => {
      if (item.id === dest.destFolderId) return false;
      if (item.type === "folder" && dest.destFolderId) {
        if (folderDescendants(destScope.items, item.id).has(dest.destFolderId)) return false;
      }
      return item.parentFolderId !== (dest.destFolderId ?? null);
    });
    if (movable.length === 0) return;
    onMove(destScope.id, movable, dest.destFolderId ?? null);
  }

  // ── Drag-to-upload (desktop files) ──────────────────────────────────────
  const canUpload = !!(currentScope && onUploadFiles && !searching);
  function hasFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types || []).includes("Files");
  }
  function onFileDragEnter(e: React.DragEvent) {
    if (!canUpload || !hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setUploadOver(true);
    setFileOverFolder(fileDropFolderAt(e));
  }
  function onFileDragOver(e: React.DragEvent) {
    if (!canUpload || !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setFileOverFolder(fileDropFolderAt(e));
  }
  function onFileDragLeave(e: React.DragEvent) {
    if (!canUpload || !hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setUploadOver(false);
      setFileOverFolder(null);
    }
  }
  function onFileDrop(e: React.DragEvent) {
    if (!canUpload || !hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setUploadOver(false);
    setFileOverFolder(null);
    const { files, skippedFolders } = droppedFiles(e.dataTransfer);
    if (!onUploadFiles || (files.length === 0 && skippedFolders === 0)) return;
    const folderId = fileDropFolderAt(e);
    const options: FileDropOptions = {
      ...(folderId ? { folderId } : {}),
      ...(skippedFolders > 0 ? { skippedFolders } : {}),
    };
    if (Object.keys(options).length > 0) onUploadFiles(files, options);
    else onUploadFiles(files);
  }

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  // Bulk actions apply to a scope's listing AND to multi-selected search results
  // (search offers the same interactions as browsing).
  const showBulk = selected.size > 1 && (searching || !!currentScope);

  // ── Miller column helpers ──────────────────────────────────────────────────

  // Click a drive in column 0: it opens in column 1. Drives are walked and
  // entered but never selected.
  function handleScopeClick(scopeId: string) {
    if (consumeSuppressedClick()) return;
    columnsContainerRef.current?.focus({ preventScroll: true });
    setFocusLevel(0);
    focusOnly(scopeId, false);
    openFolderInColumn(0, scopeId, null);
  }

  function levelRows(levelIdx: number): { id: string; title: string }[] {
    if (levelIdx === 0) {
      return embeddedScopeId ? [] : scopes.map((sc) => ({ id: sc.id, title: sc.label }));
    }
    const level = levels[levelIdx];
    if (!level) return [];
    return itemsForLevel(level).map((it) => ({ id: it.id, title: it.title || "Untitled" }));
  }

  // Compute the scope for a given column level.
  function scopeForLevel(level: ColumnLevel): DriveTreeScope | null {
    if (level.kind !== "scope") return null;
    return scopes.find((s) => s.id === level.scopeId) ?? null;
  }

  // Items for a column at the given level, filtered + sorted.
  function itemsForLevel(level: ColumnLevel): DriveItem[] {
    if (level.kind === "root") return [];
    const scope = scopeForLevel(level);
    if (!scope) return [];
    const folderId = level.folderId;
    const kids = childrenAt(scope.items, folderId).filter(
      (it) => listedUnderFilter(it, typeFilter),
    );
    return sortItems(kids, sort.key, sort.dir);
  }

  // Get the scope id for a given column level (for actions).
  function scopeIdForLevel(level: ColumnLevel): string | null {
    if (level.kind !== "scope") return null;
    return level.scopeId;
  }

  // ── The listing header's controls ─────────────────────────────────────────
  // Built here rather than inline so the header itself stays a readable row of
  // four parts: where you are, and the three ways of changing what you see.

  // Finder's < > pair: one segmented control, always present. A direction with
  // nowhere to go greys out rather than disappearing, so the controls beside it
  // never shift sideways.
  const historyPair = (
    <div data-testid="drive-history" className="inline-flex shrink-0 items-center gap-1">
      <Tooltip content="Back">
        <button
          type="button"
          data-testid="drive-back"
          aria-label="Back"
          disabled={!canGoBack}
          onClick={(e) => {
            e.stopPropagation();
            goHistory(-1);
          }}
          className="os-icon-btn disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-os-grey"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </Tooltip>
      <Tooltip content="Forward">
        <button
          type="button"
          data-testid="drive-forward"
          aria-label="Forward"
          disabled={!canGoForward}
          onClick={(e) => {
            e.stopPropagation();
            goHistory(1);
          }}
          className="os-icon-btn disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-os-grey"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </Tooltip>
    </div>
  );

  const viewToggle = (
    <div className="inline-flex shrink-0 items-center gap-1">
      {(
        [
          ["columns", Columns, "Column view"],
          ["list", ListIcon, "List view"],
          ["grid", LayoutGrid, "Grid view"],
        ] as const
      ).map(([mode, Icon, label]) => (
        <Tooltip key={mode} content={label}>
          <button
            type="button"
            data-testid={`drive-view-${mode}`}
            aria-label={label}
            aria-pressed={viewMode === mode}
            onClick={(e) => {
              e.stopPropagation();
              changeView(mode);
            }}
            className={cn("os-icon-btn", viewMode === mode && "bg-os-container text-foreground")}
          >
            <Icon className="w-4 h-4" />
          </button>
        </Tooltip>
      ))}
    </div>
  );

  // Search rests as a round icon button at the end of the header and stretches
  // into a field on focus — the Finder / Safari toolbar move. It stays open
  // while it holds a query, so results are never one blur away from losing the
  // search that produced them.
  const searchField = (
    <div
      className={cn(
        "relative shrink-0 transition-[width] duration-200 ease-out",
        // Collapsed, it is a circle the size of the header's other controls, so
        // the row reads as one set.
        searchExpanded ? "w-52" : "w-8",
      )}
    >
      <Search
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-all duration-200",
          searchExpanded ? "left-2.5" : "left-1/2 -translate-x-1/2",
        )}
      />
      <input
        ref={searchInputRef}
        type="search"
        value={search}
        data-testid="drive-search"
        aria-label="Search Drive"
        placeholder={searchExpanded ? "Search Drive" : ""}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            onSearchChange("");
            searchInputRef.current?.blur();
          }
        }}
        onChange={(e) => onSearchChange(e.target.value)}
        className={cn(
          "h-8 w-full rounded-full border border-border bg-card text-sm text-foreground",
          "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/40",
          "pl-8 transition-all duration-200",
          searchExpanded ? "pr-8 cursor-text" : "pr-0 cursor-pointer",
        )}
      />
      {search && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={(e) => {
            e.stopPropagation();
            onSearchChange("");
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  // ── Background clicks and the marquee ───────────────────────────────────────
  // A drive's top level has nothing above it but the list of drives, so a click
  // on empty space there goes up to it; anywhere else it only deselects. Never
  // for a click that ends a drag, and never for one inside a menu or dialog,
  // which render in portals but bubble to here through React.
  const atDriveTop = !!currentScope && currentFolderId === null && !embeddedScopeId && !searching;

  function handleBackgroundClick(e: ReactMouseEvent) {
    if (isInFloatingLayer(e.target)) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (atDriveTop && (e.target as Element).closest("[data-drive-pane]")) {
      onNavigate(null, null);
      return;
    }
    clearSelection();
  }

  const marqueeFor = (levelIdx: number | null) => ({
    enabled: levelIdx === null ? !columnsActive && (searching || !!currentScope) : true,
    getSelected: () => selected,
    onSelect: (ids: string[]) => {
      selectIds(ids);
      if (levelIdx !== null) setFocusLevel(levelIdx);
    },
    onDragEnd: suppressNextClick,
  });
  const paneMarquee = useMarquee(marqueeFor(null));

  const draggedCount = activeDrag ? draggedItemsFor(activeDrag).length : 0;

  const sidePanel = useSidePanel().panel;
  const besideState = useMemo<BesideState>(
    () => ({ open: onOpenBeside ?? null, activeId: sidePanel?.id ?? null }),
    [onOpenBeside, sidePanel?.id],
  );

  const rowHandlers: RowHandlers = {
    onClick: handleRowClick,
    onDoubleClick: handleRowDoubleClick,
    onContext: handleContextSelect,
    onOpen: openById,
  };

  return (
    <>
    <BesideContext.Provider value={besideState}>
    <FileDropContext.Provider value={fileOverFolder}>
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div ref={rootRef} className="flex flex-col gap-3" data-testid="drive-browser" onClick={handleBackgroundClick}>
        {/* ── Page toolbar: filters on the left, actions on the right ──
            Navigation, view and search live on the listing's own header
            instead — they act on the table, so they belong to it. ── */}
        <div className="flex items-center gap-3 flex-wrap">
          {filterControl}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {newMenu}
            {overflowMenu}
          </div>
        </div>

        {tagChips}

        <div className="flex gap-3 min-w-0 items-start">
          {/* The listing is a window: one surface whose header carries
              where you are (the trail), how you got there (< >), how you are
              looking at it (the view toggle) and what you are looking for
              (search). The page title above no longer has a stray folder name
              hanging under it, and every control that acts on the table now
              sits on the table. */}
          <div className="relative min-w-0 flex-1 overflow-hidden rounded-os-card bg-background p-5">
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              {historyPair}
              <Breadcrumb
                currentScope={currentScope}
                folderCrumbs={folderCrumbs}
                onNavigate={(scopeId, folderId) => {
                  if (!consumeSuppressedClick()) onNavigate(scopeId, folderId);
                }}
                dragging={!!activeDrag}
                showRoot={!embeddedScopeId}
              />
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {!searching && viewToggle}
                {searchField}
              </div>
            </div>
          {columnsActive ? (
            /* ── MILLER COLUMNS ─────────────────────────────────────────── */
            <div
              ref={columnsContainerRef}
              tabIndex={0}
              data-drive-pane
              onKeyDown={onPaneKeyDown}
              className={cn(
                "min-w-0 overflow-x-auto rounded-os-item border border-border focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-os-accent/30",
                // Room under the columns for the floating selection bar.
                showBulk && "pb-14",
              )}
              onDragEnter={onFileDragEnter}
              onDragOver={onFileDragOver}
              onDragLeave={onFileDragLeave}
              onDrop={onFileDrop}
              data-testid="drive-columns"
            >
              {uploadOver && !fileOverFolder && (
                <div className={DROP_OVERLAY}>
                  <span className="flex items-center gap-2 text-sm font-medium text-os-accent">
                    <Upload className="w-4 h-4" /> Drop files to upload
                  </span>
                </div>
              )}
              {/* The frame keeps one height (.drivepage-columns: min-height
                  420px) so stepping into a folder widens the trail instead of
                  growing the panel and shifting the page under the pointer.
                  Columns cap themselves at the same figure (see MillerColumn). */}
              <div className="flex min-h-[420px] divide-x divide-border">
                {/* Column 0: scope list — hidden in embedded mode (the user is
                    already inside the project context, no cross-scope nav). */}
                {!embeddedScopeId && (
                  <MillerColumn
                    testid="drive-col-root"
                    isEmpty={scopes.length === 0}
                    emptyMessage="No drives available."
                  >
                    {scopes.map((scope) => (
                      <ColumnScopeRow
                        key={scope.id}
                        scope={scope}
                        isOpen={openRowIdAt(levels, 0) === scope.id}
                        isFocused={focusId === scope.id}
                        isDragging={!!activeDrag}
                        onClick={() => handleScopeClick(scope.id)}
                      />
                    ))}
                  </MillerColumn>
                )}

                {/* Columns 1+: scope/folder contents */}
                {levels.slice(1).map((level, relIdx) => {
                  const levelIdx = relIdx + 1;
                  const sId = scopeIdForLevel(level);
                  const items = itemsForLevel(level);
                  const openId = openRowIdAt(levels, levelIdx);
                  // Partner-visible toggle: only wire it when the project has an
                  // active partner and the caller provided the callback.
                  const partnerToggle =
                    hasActivePartner && onTogglePartnerVisible
                      ? onTogglePartnerVisible
                      : undefined;

                  return (
                    <MillerColumn
                      key={`col-${levelIdx}`}
                      testid={`drive-col-${levelIdx}`}
                      isEmpty={items.length === 0}
                      emptyMessage={
                        sId === SHARED_SPACE_KEY
                          ? "Documents shared with you by name appear here."
                          : sId === FAVORITES_SPACE_KEY
                            ? "Items you favorite appear here."
                            : "This folder is empty."
                      }
                      marquee={marqueeFor(levelIdx)}
                    >
                      {items.map((item) => {
                        const scopeActions = sId ? getInternalScopeActions(sId) : null;
                        return (
                          <ContextMenu
                            key={item.id}
                            items={
                              scopeActions
                                ? itemMenuItems(
                                    item,
                                    scopeActions,
                                    () => onOpenItem(item),
                                    onToggleFavorite,
                                    partnerToggle,
                                  )
                                : null
                            }
                            ariaLabel="Item actions"
                          >
                            <ColumnItemRow
                              item={item}
                              scopeId={sId}
                              levelIdx={levelIdx}
                              isOpen={openId === item.id}
                              isFocused={focusId === item.id}
                              isSelected={selected.has(item.id)}
                              scopeActions={scopeActions}
                              onToggleFavorite={onToggleFavorite}
                              onTogglePartnerVisible={partnerToggle}
                              handlers={rowHandlers}
                            />
                          </ContextMenu>
                        );
                      })}
                    </MillerColumn>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ── LIST / GRID / SEARCH ──────────────────────────────────── */
            <div
              ref={listRef}
              tabIndex={0}
              data-drive-pane
              data-testid="drive-list-pane"
              onKeyDown={onPaneKeyDown}
              {...paneMarquee.handlers}
              onDragEnter={onFileDragEnter}
              onDragOver={onFileDragOver}
              onDragLeave={onFileDragLeave}
              onDrop={onFileDrop}
              className={cn(
                "relative min-w-0 min-h-[420px] overflow-hidden rounded-os-item border border-border select-none",
                "p-1.5 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-os-accent/30",
                // Room under the last row for the floating selection bar.
                // Padding below the content moves nothing above it.
                showBulk && "pb-14",
              )}
            >
              {uploadOver && !fileOverFolder && (
                <div className={DROP_OVERLAY}>
                  <span className="flex items-center gap-2 text-sm font-medium text-os-accent">
                    <Upload className="w-4 h-4" /> Drop files to upload
                  </span>
                </div>
              )}
              <MarqueeBox box={paneMarquee.box} />

              {searching ? (
                <SearchResults
                  hits={hits}
                  selected={selected}
                  focusId={focusId}
                  handlers={rowHandlers}
                  onOpenLocation={onNavigate}
                  getScopeActions={getInternalScopeActions}
                  onToggleFavorite={onToggleFavorite}
                />
              ) : !currentScope ? (
                // In embedded mode the scope is always pre-selected, so this
                // branch only renders in the full /drive browser. Embedded mode
                // always has a currentScope because currentScopeId = embeddedScopeId.
                <ScopeList
                  scopes={scopes}
                  viewMode={viewMode === "grid" ? "grid" : "list"}
                  focusId={focusId}
                  dragging={!!activeDrag}
                  onOpen={(id) => {
                    if (!consumeSuppressedClick()) openById(id);
                  }}
                />
              ) : (
                <ScopeContents
                  scope={currentScope}
                  atScopeTop={currentFolderId === null}
                  listing={listing}
                  viewMode={viewMode === "grid" ? "grid" : "list"}
                  sort={sort}
                  onToggleSort={toggleSort}
                  selected={selected}
                  focusId={focusId}
                  handlers={rowHandlers}
                  actions={getInternalScopeActions(currentScope.id)}
                  onToggleFavorite={onToggleFavorite}
                  onTogglePartnerVisible={
                    hasActivePartner && onTogglePartnerVisible ? onTogglePartnerVisible : undefined
                  }
                  dragging={!!activeDrag}
                />
              )}
            </div>
          )}

          {/* ── Bulk selection actions ────────────────────────────────────────
              Floated over the listing rather than stacked above it. A bar in
              the flow appears the instant the first click of a double-click
              lands, shoving the row out from under the second click — which is
              what an always-mounted fixed-height row used to prevent, at the
              cost of an empty band over every resting listing. Out of the flow
              it can be absent at rest AND move nothing when it arrives. ── */}
          <DriveBulkBar
            showBulk={showBulk}
            selectedCount={selected.size}
            selectedItems={selectedItems}
            onBulkMove={onBulkMove}
            onBulkDelete={onBulkDelete}
            onClearSelection={clearSelection}
          />
          </div>

        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag && (
          <div
            data-testid="drive-drag-ghost"
            className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 shadow-lg text-base"
          >
            {itemIcon(activeDrag.item)}
            <span className="font-medium text-foreground">
              {draggedCount > 1 ? `${draggedCount} items` : activeDrag.item.title || "Untitled"}
            </span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
    </FileDropContext.Provider>
    </BesideContext.Provider>

    {/* In-place Share dialog — mounted outside DndContext so DnD events don't
        bleed through; keyed by item id so state resets on a different target. */}
    {shareTarget && (
      <ShareDialog
        key={shareTarget.id}
        page={shareTarget}
        open={true}
        onChanged={() => {
          sharingChangedRef.current = true;
        }}
        onClose={() => {
          setShareTarget(null);
          if (sharingChangedRef.current) {
            sharingChangedRef.current = false;
            onSharingChanged?.();
          }
        }}
      />
    )}

    {folderSettings && meetingsOptionIn(folderSettings.scopeId, folderSettings.item.id) && (
      <FolderSettingsModal
        key={folderSettings.item.id}
        open
        onClose={() => setFolderSettings(null)}
        folder={folderSettings.item}
        meetings={meetingsOptionIn(folderSettings.scopeId, folderSettings.item.id)!}
      />
    )}

    {/* Quick Look — spacebar preview overlay. A modal portal, so it never
        disturbs the browser layout underneath (Google Drive / Finder pattern). */}
    {previewItem && (
      <DriveQuickPreview item={previewItem} onClose={() => setPreviewItem(null)} />
    )}
    </>
  );
}

// ── Bulk bar ─────────────────────────────────────────────────────────────────
// Multi-select actions only. A single selected item has no bar: its actions
// live in the row's context menu and the details rail.

function DriveBulkBar({
  showBulk,
  selectedCount,
  selectedItems,
  onBulkMove,
  onBulkDelete,
  onClearSelection,
}: {
  showBulk: boolean;
  selectedCount: number;
  selectedItems: DriveItem[];
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

function DriveQuickPreview({ item, onClose }: { item: DriveItem; onClose: () => void }) {
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6"
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

function ColumnScopeRow({
  scope,
  isOpen,
  isFocused,
  isDragging,
  onClick,
}: {
  scope: DriveTreeScope;
  /** This is the drive the columns to the right are showing. */
  isOpen: boolean;
  /** The keyboard is on this row. */
  isFocused: boolean;
  isDragging: boolean;
  onClick: () => void;
}) {
  const tiles = useFeatureFlag("desktop-tabs");
  const t = useDriveText();
  const drop = useScopeDrop(scope.id, isDragging);

  // Signal ③: audience chip revealed on hover, when the scope carries a scopeAudience label.
  // Reuses the PageRow opacity-reveal convention.
  const audienceChip = scope.scopeAudience ? (
    <span className="shrink-0 text-[10px] tracking-wide text-muted-foreground opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      {scope.scopeAudience}
    </span>
  ) : null;

  return (
    <div
      ref={drop.setNodeRef}
      data-testid={`drive-scope-${scope.id}`}
      data-col-level={0}
      data-row-id={scope.id}
      data-marquee-ignore
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`group flex items-center rounded-lg ${t.itemRow} ${t.row} cursor-default select-none ${
        drop.isOver
          ? `${DROP_RING} text-os-accent`
          : isOpen
            ? "bg-os-container text-foreground"
            : "text-foreground hover:bg-os-hover"
      } ${isFocused && !drop.isOver ? "ring-1 ring-inset ring-os-accent/50" : ""}`}
    >
      {scopeIcon(scope, "sm", tiles)}
      <span className="min-w-0 flex-1 truncate font-medium">{scopeLabel(scope)}</span>
      {audienceChip}
    </div>
  );
}

// ── Column view: draggable item row (columns 1+) ──────────────────────────────

function ColumnItemRow({
  item,
  scopeId,
  levelIdx,
  isOpen,
  isFocused,
  isSelected,
  scopeActions,
  onToggleFavorite,
  onTogglePartnerVisible,
  handlers,
  onContextMenu,
}: {
  item: DriveItem;
  scopeId: string | null;
  /** Which column this row is in — keyboard navigation scrolls by it. */
  levelIdx: number;
  /** This is the folder whose contents the next column shows. */
  isOpen: boolean;
  /** The keyboard is on this row. */
  isFocused: boolean;
  isSelected: boolean;
  scopeActions: RowActions | null;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
  handlers: RowHandlers;
  /** Handed down by the wrapping ContextMenu, which opens the menu from it. */
  onContextMenu?: (e: ReactMouseEvent) => void;
}) {
  const t = useDriveText();
  const isManaged = item.type === "agreement" || item.type === "rubric";
  const drag = useDraggable({
    id: `col::${scopeId}::${item.id}`,
    data: { item, scopeId },
    disabled: isManaged || !scopeId,
  });
  // Folders in a column accept drops, the same way the list/grid rows do —
  // dragging into a folder is the gesture this view is shaped around, and
  // without it the column view could only move things via the crumb trail.
  const drop = useDroppable({
    id: `col::drop::${scopeId}::${item.id}`,
    data: dropData(item, scopeId),
    disabled: !acceptsDrops(item) || !scopeId,
  });
  const fileDrop = useFileDropFolder(item);
  const besideActive = useBeside(item).active;
  function setRefs(node: HTMLDivElement | null) {
    drag.setNodeRef(node);
    if (acceptsDrops(item)) drop.setNodeRef(node);
  }

  return (
    <div
      ref={setRefs}
      {...drag.attributes}
      {...drag.listeners}
      {...fileDrop.attrs}
      data-testid={`drive-item-${item.type}-${item.id}`}
      data-col-level={levelIdx}
      data-row-id={item.id}
      data-item-id={item.id}
      onClick={(e) => handlers.onClick(item.id, e)}
      onDoubleClick={(e) => handlers.onDoubleClick(item.id, e)}
      data-selected={isSelected}
      onContextMenu={(e) => {
        handlers.onContext(item.id);
        onContextMenu?.(e);
      }}
      className={`group flex items-center rounded-lg dnd-touch-handle ${t.itemRow} ${t.row} cursor-default select-none ${
        drag.isDragging ? "opacity-40" : ""
      } ${
        drop.isOver || fileDrop.over ? DROP_RING : ""
      } ${
        isSelected
          ? "bg-os-container text-os-accent"
          : isOpen
            ? "bg-os-container text-foreground"
            : besideActive
              ? "bg-os-accent/10 text-foreground"
              : "text-foreground hover:bg-os-hover"
      } ${isFocused && !drop.isOver && !fileDrop.over ? "ring-1 ring-inset ring-os-accent/50" : ""}`}
    >
      <ItemGlyphTip item={item} />
      <Truncated text={item.title || "Untitled"} className="flex-1 font-medium" />
      <ModifiedCaption item={item} />
      <BesideMark item={item} />
<RowTags item={item} actions={scopeActions} />
      <RowAudience item={item} actions={scopeActions} />
      {/* Signal ②: process linkage pill. */}
      {item.linkedProcess && (
        <ProcessLinkPill label={item.linkedProcess.label} href={item.linkedProcess.href} />
      )}
      {/* Partner-visible badge: teal handshake shown when this doc/file is
          shared with the project's partner org. Mirrors the badge used in
          the legacy DocumentsBlock. */}
      {(item.type === "doc" || item.type === "file") &&
        (item as { partnerVisible?: boolean | null }).partnerVisible && (
          <Tooltip content="Shared with partner">
            <span className="flex items-center text-accent-teal shrink-0">
              <Handshake className="w-3.5 h-3.5" />
            </span>
          </Tooltip>
        )}
      {/* Actions menu */}
      {scopeActions && (
        <RowActionsMenu
          item={item}
          actions={scopeActions}
          onOpen={() => handlers.onOpen(item.id)}
          onToggleFavorite={onToggleFavorite}
          onTogglePartnerVisible={onTogglePartnerVisible}
        />
      )}
    </div>
  );
}

// ── Column view: preview column (rightmost, for the selected leaf) ────────────

/**
 * One column's sizing — every column in the row wears it, preview included.
 * Equal shares of the frame while they fit (so a single column at a drive's top
 * level fills the panel rather than leaving it empty beside a 240px sliver),
 * then a floor that stops them squeezing and hands the overflow to the row's
 * horizontal scroll, the way Finder's columns behave.
 */
const COLUMN_SIZE = "flex-1 min-w-[12.5rem]";

/** "12 items" / "Empty" after a folder's name; nothing for other items or before counts load. */
/** When the item last changed, after its name in the listings that have no Modified column. */
function ModifiedCaption({ item, className = "" }: { item: DriveItem; className?: string }) {
  const t = useDriveText();
  // A project or offering row is drawn by the app, not edited: it has no modified time.
  if (item.type === "folder" && item.system) return null;
  return (
    <span data-testid="item-modified" className={`shrink-0 ${t.meta} text-muted-foreground tabular-nums ${className}`}>
      {relativeTime(item.updatedAt as unknown as string)}
    </span>
  );
}

/** Tag dots after a row's title; clicking one filters the Drive by that tag. */
function RowTags({ item, actions }: { item: DriveItem; actions: RowActions | null }) {
  if (item.type !== "doc" && item.type !== "folder" && item.type !== "form") return null;
  return <TagDots tags={item.tags} onApply={actions?.onTagClick} />;
}

/** The audience marker for a row; clicking opens Share for items that have one. */
function RowAudience({ item, actions }: { item: DriveItem; actions: RowActions | null }) {
  if (item.type !== "doc" && item.type !== "folder" && item.type !== "file" && item.type !== "form") return null;
  if (!item.audience) return null;
  const share = item.type !== "file" && (item.type !== "form" || actions?.formShare) ? actions?.onShare : undefined;
  return <AudienceSignal audience={item.audience} onOpenShare={share ? () => share(item) : undefined} />;
}

// ── Miller column wrapper ─────────────────────────────────────────────────────


function MillerColumn({
  children,
  testid,
  isEmpty,
  emptyMessage,
  marquee,
}: {
  children: ReactNode;
  testid?: string;
  isEmpty: boolean;
  emptyMessage: string;
  /** Drag-to-select on the column's empty space; omitted for the list of drives. */
  marquee?: Parameters<typeof useMarquee>[0];
}) {
  const t = useDriveText();
  const { box, handlers } = useMarquee(marquee ?? { enabled: false, getSelected: () => new Set(), onSelect: () => {}, onDragEnd: () => {} });
  return (
    <div
      data-testid={testid}
      {...handlers}
      // Every column shares the row on the same terms (COLUMN_SIZE) and caps
      // at the frame's own height, scrolling a long folder inside the panel
      // rather than down the page.
      className={`relative flex ${COLUMN_SIZE} flex-col overflow-y-auto max-h-[420px] p-1.5`}
    >
      <MarqueeBox box={box} />
      {isEmpty ? (
        <p className={`px-2.5 py-4 ${t.meta} text-os-muted`}>{emptyMessage}</p>
      ) : (
        <div className="flex flex-col">{children}</div>
      )}
    </div>
  );
}

// ── Breadcrumb (with overflow collapse) ──────────────────────────────────────

function Breadcrumb({
  currentScope,
  folderCrumbs,
  onNavigate,
  dragging,
  showRoot,
}: {
  currentScope: DriveTreeScope | null;
  folderCrumbs: { id: string; title: string }[];
  onNavigate: (scopeId: string | null, folderId: string | null) => void;
  dragging: boolean;
  /** The trail starts at "Drive", which goes back to the list of drives (not in an embedded project tab). */
  showRoot: boolean;
}) {
  // The trail is always mounted at a constant height: appearing/disappearing as
  // you enter and leave a folder was the top source of vertical layout shift
  // (content below jumped by a row + gap). The row now holds its height even at
  // a drive root, where the scope crumb ("My Drive" / "Lab" / the project name)
  // stands in as a stable "you are here" — matching Google Drive, whose
  // breadcrumb is always present.
  const collapse = folderCrumbs.length > 3;
  const hidden = collapse ? folderCrumbs.slice(0, folderCrumbs.length - 2) : [];
  const shown = collapse ? folderCrumbs.slice(folderCrumbs.length - 2) : folderCrumbs;

  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="drive-breadcrumb"
      className="flex flex-wrap items-center gap-2 min-w-0 min-h-[1.75rem] text-base"
    >
      {showRoot && (
        <button
          type="button"
          data-testid="drive-crumb-root"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(null, null);
          }}
          className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted/50 ${
            currentScope ? "text-muted-foreground hover:text-foreground" : "font-medium text-foreground"
          }`}
        >
          <HardDrive className="w-4 h-4 text-os-accent" />
          Drive
        </button>
      )}
      {/* The scope crumb leads the trail and is now always shown while a scope
          is active — at a drive root it is the constant "you are here" that
          keeps this row from collapsing (and shifting the page) as you move in
          and out of folders. */}
      {currentScope && (
        <Crumb
          label={scopeLabel(currentScope)}
          testid="drive-crumb-scope"
          scopeId={currentScope.id}
          destFolderId={null}
          onNavigate={() => onNavigate(currentScope.id, null)}
          dragging={dragging}
          first={!showRoot}
          current={folderCrumbs.length === 0}
        />
      )}
      {collapse && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <Menu
            align="left"
            ariaLabel="Hidden path segments"
            trigger={
              <button
                type="button"
                className="rounded px-1 py-0.5 text-muted-foreground hover:bg-muted/50"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            }
          >
            {hidden.map((c) => (
              <Menu.Item key={c.id} onSelect={() => onNavigate(currentScope!.id, c.id)}>
                {c.title}
              </Menu.Item>
            ))}
          </Menu>
        </>
      )}
      {shown.map((c, i) => (
        <Crumb
          key={c.id}
          label={c.title}
          testid={`drive-crumb-${c.id}`}
          scopeId={currentScope!.id}
          destFolderId={c.id}
          onNavigate={() => onNavigate(currentScope!.id, c.id)}
          dragging={dragging}
          current={i === shown.length - 1}
        />
      ))}
    </nav>
  );
}

function Crumb({
  label,
  testid,
  scopeId,
  destFolderId,
  onNavigate,
  dragging,
  first = false,
  current = false,
}: {
  label: string;
  testid: string;
  scopeId: string;
  destFolderId: string | null;
  onNavigate: () => void;
  dragging: boolean;
  /** Leads the trail (no root crumb before it), so it takes no separator. */
  first?: boolean;
  /** Ends the trail — where you are, so it carries the full ink. */
  current?: boolean;
}) {
  const drop = useDroppable({
    id: `crumb::${scopeId}::${destFolderId ?? "_root_"}`,
    data: { destFolderId, destScopeId: scopeId },
    disabled: !dragging,
  });
  return (
    <>
      {!first && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      <button
        type="button"
        ref={drop.setNodeRef}
        data-testid={testid}
        onClick={(e) => {
          e.stopPropagation();
          onNavigate();
        }}
        className={`inline-flex items-center rounded-md px-1.5 py-0.5 truncate max-w-[12rem] ${
          drop.isOver
            ? `${DROP_RING} text-os-accent`
            : current
              ? "font-medium text-foreground hover:bg-os-hover"
              : "text-muted-foreground hover:bg-os-hover hover:text-foreground"
        }`}
      >
        {label}
      </button>
    </>
  );
}

// ── Root: the list of drives (list/grid view only) ───────────────────────────

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

type ScopeEntryProps = {
  scope: DriveTreeScope;
  focused: boolean;
  dragging: boolean;
  onOpen: (id: string) => void;
};

function ScopeTile({ scope, focused, dragging, onOpen }: ScopeEntryProps) {
  const tiles = useFeatureFlag("desktop-tabs");
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
      {scopeIcon(scope, "xl", tiles)}
      <span className={`${GRID_LABEL} ${focused ? "bg-os-accent text-os-bg" : "text-foreground"}`}>
        {scopeLabel(scope)}
      </span>
    </div>
  );
}

function ScopeRow({ scope, focused, dragging, onOpen }: ScopeEntryProps) {
  const tiles = useFeatureFlag("desktop-tabs");
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
      {scopeIcon(scope, "sm", tiles)}
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

export function ScopeContents({
  scope,
  atScopeTop,
  listing,
  viewMode,
  sort,
  onToggleSort,
  selected,
  focusId,
  handlers,
  actions,
  onToggleFavorite,
  onTogglePartnerVisible,
  dragging,
}: {
  scope: DriveTreeScope;
  /** The space's top level, where folders sit in a band above the files. */
  atScopeTop: boolean;
  listing: DriveItem[];
  viewMode: "list" | "grid";
  sort: { key: SortKey; dir: SortDir };
  onToggleSort: (key: SortKey) => void;
  selected: Set<string>;
  focusId: string | null;
  handlers: RowHandlers;
  actions: RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
  dragging: boolean;
}) {
  const t = useDriveText();
  const isSharedSpace = scope.id === SHARED_SPACE_KEY;
  if (listing.length === 0) {
    return (
      <EmptyLine>
        {isSharedSpace
          ? "Documents shared with you by name appear here."
          : "This folder is empty. Drop files here to upload."}
      </EmptyLine>
    );
  }

  const bandFolders = atScopeTop ? listing.filter((item) => item.type === "folder") : [];
  const files = atScopeTop ? listing.filter((item) => item.type !== "folder") : listing;
  const band =
    bandFolders.length > 0 ? (
      <section aria-label="Folders" data-testid="drive-folder-band">
        <h3 className={`px-2 pb-1.5 pt-1 ${t.label} font-medium uppercase tracking-wide text-muted-foreground`}>
          Folders
        </h3>
        <div data-grid-block className="flex gap-3 overflow-x-auto px-2 pb-3">
          {bandFolders.map((item) => (
            <FolderCard
              key={item.id}
              item={item}
              scopeId={scope.id}
              selected={selected.has(item.id)}
              focused={focusId === item.id}
              handlers={handlers}
              actions={actions}
              onToggleFavorite={onToggleFavorite}
              onTogglePartnerVisible={onTogglePartnerVisible}
            />
          ))}
        </div>
      </section>
    ) : null;
  const filesHeading =
    band && files.length > 0 ? (
      <h3 className={`px-2 pb-1 pt-1 ${t.label} font-medium uppercase tracking-wide text-muted-foreground`}>Files</h3>
    ) : null;

  if (viewMode === "grid") {
    return (
      <div data-testid="drive-listing">
        {band}
        {filesHeading}
        {files.length > 0 && (
          <div className={GRID_CONTAINER} data-grid-block>
            {files.map((item) => (
              <GridTile
                key={item.id}
                item={item}
                scopeId={scope.id}
                selected={selected.has(item.id)}
                focused={focusId === item.id}
                handlers={handlers}
                actions={actions}
                onToggleFavorite={onToggleFavorite}
                onTogglePartnerVisible={onTogglePartnerVisible}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="drive-listing">
      {band}
      {filesHeading}
      {files.length > 0 && (
        <>
          {/* Column header (sortable) */}
          <div
            className={`grid items-center gap-2 border-b border-border px-2 py-1.5 ${t.label} font-medium uppercase tracking-wide text-muted-foreground`}
            style={{ gridTemplateColumns: isSharedSpace ? SHARED_GRID_COLUMNS : GRID_COLUMNS }}
          >
            <SortHeader label="Name" active={sort.key === "name"} dir={sort.dir} onClick={() => onToggleSort("name")} testid="drive-sort-name" />
            {isSharedSpace && (
              <SortHeader label="Shared by" active={sort.key === "shared"} dir={sort.dir} onClick={() => onToggleSort("shared")} testid="drive-sort-shared" />
            )}
            <SortHeader label="Modified" active={sort.key === "modified"} dir={sort.dir} onClick={() => onToggleSort("modified")} testid="drive-sort-modified" />
            <SortHeader label="Size" active={sort.key === "size"} dir={sort.dir} onClick={() => onToggleSort("size")} align="right" testid="drive-sort-size" />
            <span aria-hidden="true" />
          </div>
          <div className="flex flex-col divide-y divide-border/50">
            {files.map((item) => (
              <ListRow
                key={item.id}
                item={item}
                scopeId={scope.id}
                selected={selected.has(item.id)}
                focused={focusId === item.id}
                handlers={handlers}
                actions={actions}
                onToggleFavorite={onToggleFavorite}
                onTogglePartnerVisible={onTogglePartnerVisible}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = "left",
  testid,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
  testid: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "justify-end" : ""} ${active ? "text-foreground" : ""}`}
    >
      {label}
      {active && (dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
  );
}

function ListRow({
  item,
  scopeId,
  selected,
  focused,
  handlers,
  actions,
  onToggleFavorite,
  onTogglePartnerVisible,
}: {
  item: DriveItem;
  scopeId: string;
  selected: boolean;
  /** The keyboard is on this row. */
  focused: boolean;
  handlers: RowHandlers;
  actions: RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
}) {
  const t = useDriveText();
  const isManaged = item.type === "agreement" || item.type === "rubric";
  const drag = useDraggable({
    id: `${scopeId}::${item.id}`,
    data: { item, scopeId },
    disabled: isManaged,
  });
  const drop = useDroppable({
    id: `${scopeId}::drop::${item.id}`,
    data: dropData(item, scopeId),
    disabled: !acceptsDrops(item),
  });
  const fileDrop = useFileDropFolder(item);
  const besideActive = useBeside(item).active;
  function setRefs(node: HTMLDivElement | null) {
    drag.setNodeRef(node);
    if (acceptsDrops(item)) drop.setNodeRef(node);
  }

  const row = (
    <div
      ref={setRefs}
      {...drag.attributes}
      {...drag.listeners}
      {...fileDrop.attrs}
      data-testid={`drive-item-${item.type}-${item.id}`}
      data-item-id={item.id}
      onClick={(e) => handlers.onClick(item.id, e)}
      onDoubleClick={(e) => handlers.onDoubleClick(item.id, e)}
      data-selected={selected}
      onContextMenu={() => handlers.onContext(item.id)}
      style={{ gridTemplateColumns: scopeId === SHARED_SPACE_KEY ? SHARED_GRID_COLUMNS : GRID_COLUMNS }}
      className={`group grid items-center dnd-touch-handle ${t.itemRow} rounded-lg ${t.row} cursor-default select-none ${
        drag.isDragging ? "opacity-40" : ""
      } ${
        (drop.isOver && acceptsDrops(item)) || fileDrop.over
          ? DROP_RING
          : selected
            ? "bg-os-container"
            : besideActive
              ? "bg-os-accent/10"
              : focused
                ? "bg-os-hover"
                : "hover:bg-os-hover"
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <ItemGlyphTip item={item} />
        <Truncated text={item.title || "Untitled"} className="font-medium text-foreground" />
        <BesideMark item={item} />
<RowTags item={item} actions={actions} />
        <RowAudience item={item} actions={actions} />
        {/* Signal ②: process linkage pill. */}
        {item.linkedProcess && (
          <ProcessLinkPill label={item.linkedProcess.label} href={item.linkedProcess.href} />
        )}
        {/* Partner-visible badge: teal handshake when shared with the project's partner. */}
        {(item.type === "doc" || item.type === "file") &&
          (item as { partnerVisible?: boolean | null }).partnerVisible && (
            <Tooltip content="Shared with partner">
              <span className="flex items-center text-accent-teal shrink-0">
                <Handshake className="w-3.5 h-3.5" />
              </span>
            </Tooltip>
          )}
      </span>
      {scopeId === SHARED_SPACE_KEY && (
        <span className={`${t.meta} text-muted-foreground truncate`}>
          {item.type === "doc" ? (item.sharedBy?.name ?? "Unknown") : ""}
        </span>
      )}
      <span className={`${t.meta} text-muted-foreground tabular-nums truncate`}>{relativeTime(item.updatedAt as unknown as string)}</span>
      <span className={`${t.meta} text-muted-foreground tabular-nums text-right`}>{formatSize(item.sizeBytes)}</span>
      <span className="flex items-center justify-end">
        <RowActionsMenu
          item={item}
          actions={actions}
          onOpen={() => handlers.onOpen(item.id)}
          onToggleFavorite={onToggleFavorite}
          onTogglePartnerVisible={onTogglePartnerVisible}
        />
      </span>
    </div>
  );

  return (
    <ContextMenu
      items={itemMenuItems(item, actions, () => handlers.onOpen(item.id), onToggleFavorite, onTogglePartnerVisible)}
      ariaLabel="Item actions"
    >
      {row}
    </ContextMenu>
  );
}

function GridTile({
  item,
  scopeId,
  selected,
  focused,
  handlers,
  actions,
  onToggleFavorite,
  onTogglePartnerVisible,
}: {
  item: DriveItem;
  scopeId: string;
  selected: boolean;
  /** The keyboard is on this tile. */
  focused: boolean;
  handlers: RowHandlers;
  actions: RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
}) {
  const t = useDriveText();
  const isManaged = item.type === "agreement" || item.type === "rubric";
  const drag = useDraggable({
    id: `${scopeId}::${item.id}`,
    data: { item, scopeId },
    disabled: isManaged,
  });
  const drop = useDroppable({
    id: `${scopeId}::drop::${item.id}`,
    data: dropData(item, scopeId),
    disabled: !acceptsDrops(item),
  });
  const fileDrop = useFileDropFolder(item);
  function setRefs(node: HTMLDivElement | null) {
    drag.setNodeRef(node);
    if (acceptsDrops(item)) drop.setNodeRef(node);
  }

  const tile = (
    <div
      ref={setRefs}
      {...drag.attributes}
      {...drag.listeners}
      {...fileDrop.attrs}
      data-testid={`drive-item-${item.type}-${item.id}`}
      data-item-id={item.id}
      onClick={(e) => handlers.onClick(item.id, e)}
      onDoubleClick={(e) => handlers.onDoubleClick(item.id, e)}
      data-selected={selected}
      onContextMenu={() => handlers.onContext(item.id)}
      // No card around a tile: the icon is the object, the way a Finder icon
      // view reads. Selection lives on the label chip below (Finder's blue
      // rectangle), not on a border, so a grid of files reads as a grid of
      // files rather than a grid of boxes.
      className={`${GRID_TILE} dnd-touch-handle ${
        drag.isDragging ? "opacity-40" : ""
      } ${
        (drop.isOver && acceptsDrops(item)) || fileDrop.over
          ? DROP_RING
          : selected
            ? "bg-os-container/40"
            : focused
              ? "bg-os-hover"
              : "hover:bg-os-hover"
      }`}
    >
      <div className="absolute right-1 top-1 flex items-center">
        <RowActionsMenu
          item={item}
          actions={actions}
          onOpen={() => handlers.onOpen(item.id)}
          onToggleFavorite={onToggleFavorite}
          onTogglePartnerVisible={onTogglePartnerVisible}
        />
      </div>
      {/* Partner-visible badge: positioned top-left so it doesn't conflict
          with the actions/star buttons on the right. */}
      {(item.type === "doc" || item.type === "file") &&
        (item as { partnerVisible?: boolean | null }).partnerVisible && (
          <Tooltip content="Shared with partner">
            <span className="absolute left-6 top-1.5 flex items-center text-accent-teal">
              <Handshake className="w-3 h-3" />
            </span>
          </Tooltip>
        )}
      <ItemGlyphTip item={item} size="xl" />
      <Truncated
        text={item.title || "Untitled"}
        className={`${GRID_LABEL} ${
          selected ? "bg-os-accent text-os-bg" : "text-foreground"
        }`}
      />
      <ModifiedCaption item={item} />
      <BesideMark item={item} />
<RowTags item={item} actions={actions} />
      <RowAudience item={item} actions={actions} />
      {/* Signal ②: process linkage pill. Centered below the title. */}
      {item.linkedProcess && (
        <ProcessLinkPill label={item.linkedProcess.label} href={item.linkedProcess.href} />
      )}
    </div>
  );

  return (
    <ContextMenu
      items={itemMenuItems(item, actions, () => handlers.onOpen(item.id), onToggleFavorite, onTogglePartnerVisible)}
      ariaLabel="Item actions"
    >
      {tile}
    </ContextMenu>
  );
}

function FolderCard({
  item,
  scopeId,
  selected,
  focused,
  handlers,
  actions,
  onToggleFavorite,
  onTogglePartnerVisible,
}: {
  item: DriveItem;
  scopeId: string;
  selected: boolean;
  /** The keyboard is on this card. */
  focused: boolean;
  handlers: RowHandlers;
  actions: RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
}) {
  const t = useDriveText();
  const drag = useDraggable({ id: `${scopeId}::${item.id}`, data: { item, scopeId } });
  const drop = useDroppable({
    id: `${scopeId}::drop::${item.id}`,
    data: { destFolderId: item.id, destScopeId: scopeId },
  });
  const fileDrop = useFileDropFolder(item);
  function setRefs(node: HTMLDivElement | null) {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  }

  const card = (
    <div
      ref={setRefs}
      {...drag.attributes}
      {...drag.listeners}
      {...fileDrop.attrs}
      data-testid={`drive-item-${item.type}-${item.id}`}
      data-item-id={item.id}
      onClick={(e) => handlers.onClick(item.id, e)}
      onDoubleClick={(e) => handlers.onDoubleClick(item.id, e)}
      data-selected={selected}
      onContextMenu={() => handlers.onContext(item.id)}
      className={`group relative flex w-48 shrink-0 flex-col gap-3 rounded-os-card border border-border p-3 dnd-touch-handle cursor-default select-none transition-colors ${
        drag.isDragging ? "opacity-40" : ""
      } ${
        drop.isOver || fileDrop.over
          ? DROP_RING
          : selected
            ? "bg-os-container"
            : focused
              ? "bg-os-hover"
              : "bg-os-card hover:bg-os-card-hover"
      }`}
    >
      <div className="absolute right-1.5 top-1.5 flex items-center">
        <RowActionsMenu
          item={item}
          actions={actions}
          onOpen={() => handlers.onOpen(item.id)}
          onToggleFavorite={onToggleFavorite}
          onTogglePartnerVisible={onTogglePartnerVisible}
        />
      </div>
      <ItemGlyphTip item={item} size="lg" />
      <div className="flex min-w-0 flex-col gap-1">
        <Truncated text={item.title || "Untitled"} className={`${t.row} font-medium text-foreground`} />
        <span className="flex items-center gap-2">
          <ModifiedCaption item={item} />
          <BesideMark item={item} />
<RowTags item={item} actions={actions} />
          <RowAudience item={item} actions={actions} />
        </span>
      </div>
    </div>
  );

  return (
    <ContextMenu
      items={itemMenuItems(item, actions, () => handlers.onOpen(item.id), onToggleFavorite, onTogglePartnerVisible)}
      ariaLabel="Item actions"
    >
      {card}
    </ContextMenu>
  );
}

// ── Search results ───────────────────────────────────────────────────────────

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

function EmptyLine({ children }: { children: ReactNode }) {
  const t = useDriveText();
  return <p className={`px-3 py-8 text-center ${t.row} text-muted-foreground italic`}>{children}</p>;
}
