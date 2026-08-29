// DriveBrowser — Miller-column (Finder-style) browser for the unified Drive.
//
// PRIMARY VIEW: Miller columns — a horizontally-scrolling row of columns.
//   Column 0 = scope list (My Drive, Lab, Core, Hiring, Projects).
//   Each scope/folder click opens a new column to the right.
//   Selecting a leaf shows an action toolbar above the columns.
//
// SECONDARY VIEWS: list / grid (same data, single-folder view, matching the old
//   single-location browse — toggled via the view buttons in the toolbar row).
//
// ALL pre-existing features are preserved:
//   • Type filter, search, create folder/doc, drag-and-drop internal move,
//     drag-to-upload from desktop, favorites, rename, move, delete, bulk delete,
//     context menu, keyboard navigation, breadcrumb, sort.

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
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileSignature,
  Folder,
  Handshake,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Trash2,
  FolderInput,
  User,
  Users,
  Shield,
  Briefcase,
  HardDrive,
  Search,
  X,
  Star,
  List as ListIcon,
  LayoutGrid,
  Upload,
  FolderOpen,
  Download,
  Share2,
  Columns,
  ClipboardCheck,
  Mail,
} from "lucide-react";
import type { DriveItem } from "~/lib/drive.server";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import { PageIcon } from "~/components/PageIcon";
import { Menu, ContextMenu, Tooltip } from "~/components/ui/floating";
import { ShareDialog } from "~/components/sharing/ShareDialog";
import { relativeTime } from "~/lib/relative-time";
import { cn } from "~/lib/cn";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { ProcessLinkPill } from "~/components/drive/ProcessLinkPill";

/* Drive's type scale. It was written a step below the rest of the app — rows at
   text-sm, metadata at text-xs, column headers at 11px — which reads as a
   different product next to the design, where a list row is text-base (the rail
   rows, the project cards). A context rather than a prop threaded through
   fourteen sub-components, and one place to change if the scale moves again. */
const DriveScale = createContext(false);

function useDriveText() {
  const os = useContext(DriveScale);
  return {
    /** A list/column row. */
    row: os ? "text-base" : "text-sm",
    /** Secondary metadata beside a row — modified, size, path, kind. */
    meta: os ? "text-sm" : "text-xs",
    /** Column headers and other all-caps micro-labels. */
    label: os ? "text-xs" : "text-[11px]",
    /** The "Core only" / "Project" row badges. */
    badge: os ? "text-xs" : "text-[10px]",
  };
}

export type RowActions = {
  onRename: (item: DriveItem) => void;
  onRequestMove: (item: DriveItem) => void;
  onDelete: (item: DriveItem) => void;
  /** Open the in-place Share dialog for a page-backed item (doc or folder). */
  onShare?: (item: DriveItem) => void;
};

type SortKey = "name" | "modified" | "size";
type SortDir = "asc" | "desc";
type ViewMode = "columns" | "list" | "grid";

export type DriveBrowserProps = {
  scopes: DriveTreeScope[];
  currentScopeId: string | null;
  currentFolderId: string | null;
  typeFilter: "all" | "doc" | "file" | "form" | "agreement" | "emailTemplate" | "rubric";
  search: string;
  onSearchChange: (q: string) => void;
  onNavigate: (scopeId: string | null, folderId: string | null) => void;
  onOpenItem: (item: DriveItem) => void;
  onMove: (scopeId: string, item: DriveItem, destFolderId: string | null) => void;
  getScopeActions: (scopeId: string) => RowActions;
  /** Toggle the viewer's favorite on a page item (doc/folder). */
  onToggleFavorite?: (item: DriveItem) => void;
  /** Delete every item in the set (one confirm, handled by the hub). */
  onBulkDelete?: (items: DriveItem[]) => void;
  /** Move every item in the set to another drive/folder (picker + confirm in the hub). */
  onBulkMove?: (items: DriveItem[]) => void;
  /** Move a single item from one drive scope to another (confirm + re-scope handled by hub). */
  onMoveToScope?: (sourceScopeId: string, destScopeId: string, item: DriveItem) => void;
  /** Upload files dropped from the desktop into the current scope+folder. */
  onUploadFiles?: (files: File[]) => void;
  filterControl?: ReactNode;
  newMenu?: ReactNode;
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
      return "Document";
    case "file":
      return "File";
    case "form":
      return "Form";
    case "rubric":
      return "Rubric";
    case "emailTemplate":
      return "Email Template";
    default:
      return "Agreement";
  }
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

// Folders always group first; sort within each group by the chosen key.
function sortItems(items: DriveItem[], key: SortKey, dir: SortDir): DriveItem[] {
  const cmp = (a: DriveItem, b: DriveItem) => {
    let r = 0;
    if (key === "name") r = (a.title || "").localeCompare(b.title || "");
    else if (key === "modified") r = ms(a.updatedAt) - ms(b.updatedAt);
    else r = (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
    if (r === 0) r = (a.title || "").localeCompare(b.title || "");
    return dir === "asc" ? r : -r;
  };
  const folders = items.filter((i) => i.type === "folder").sort(cmp);
  const rest = items.filter((i) => i.type !== "folder").sort(cmp);
  return [...folders, ...rest];
}

export function crumbsFor(
  items: DriveItem[],
  folderId: string | null,
): { id: string; title: string }[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const chain: { id: string; title: string }[] = [];
  let cursor = folderId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    chain.unshift({ id: node.id, title: node.title || "Untitled" });
    cursor = node.parentFolderId;
  }
  return chain;
}

export type SearchHit = { scope: DriveTreeScope; item: DriveItem; path: string };

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
      if (typeFilter !== "all" && item.type !== typeFilter) continue;
      if (needle && !(item.title || "").toLowerCase().includes(needle)) continue;
      if (tagFilter && !tagFilter(item)) continue;
      const crumbs = crumbsFor(scope.items, item.parentFolderId);
      const path = [scope.label, ...crumbs.map((c) => c.title)].join(" › ");
      hits.push({ scope, item, path });
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

function itemIcon(item: DriveItem, big = false) {
  const cls = big ? "w-8 h-8" : "w-4 h-4";
  switch (item.type) {
    case "folder":
      // Folders that mirror an entity (project/offering) or that the user gave a
      // custom emoji carry `iconEmoji` — show it instead of the generic glyph.
      return item.iconEmoji ? (
        <span className={`${cls} flex items-center justify-center leading-none shrink-0 ${big ? "text-2xl" : "text-sm"}`}>
          {item.iconEmoji}
        </span>
      ) : (
        <Folder className={`${cls} text-accent-coral/80 shrink-0`} />
      );
    case "file":
      return <Paperclip className={`${cls} text-muted-foreground shrink-0`} />;
    case "form":
      return <ClipboardList className={`${cls} text-muted-foreground shrink-0`} />;
    case "agreement":
      return <FileSignature className={`${cls} text-muted-foreground shrink-0`} />;
    case "rubric":
      return <ClipboardCheck className={`${cls} text-muted-foreground shrink-0`} />;
    case "emailTemplate":
      return <Mail className={`${cls} text-muted-foreground shrink-0`} />;
    default:
      return <PageIcon iconEmoji={item.iconEmoji} />;
  }
}

function scopeIcon(scope: DriveTreeScope) {
  if (scope.id === "mine") return <User className="w-4 h-4 text-muted-foreground shrink-0" />;
  if (scope.id === "core") return <Shield className="w-4 h-4 text-accent-coral/80 shrink-0" />;
  if (scope.id === "hiring") return <Briefcase className="w-4 h-4 text-accent-coral/80 shrink-0" />;
  if (scope.id === "lab") return <Users className="w-4 h-4 text-muted-foreground shrink-0" />;
  // Synthetic group scopes use a folder icon (no emoji on the group itself).
  if (scope.id === "projects" || scope.id === "education") return <Folder className="w-4 h-4 text-accent-coral/80 shrink-0" />;
  if (scope.iconEmoji) return <span className="text-base leading-none shrink-0">{scope.iconEmoji}</span>;
  return <Folder className="w-4 h-4 text-accent-coral/80 shrink-0" />;
}

// Menu.Item nodes shared by the row "⋯" dropdown and the right-click menu.
function itemMenuItems(
  item: DriveItem,
  actions: RowActions,
  onOpen: () => void,
  onToggleFavorite?: (item: DriveItem) => void,
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void,
): ReactNode {
  // Signal ①: system-managed folders (systemKey set) hide Delete/Rename entirely.
  // The gate extends the existing type-based canMove gate at lines 258-260.
  const isSystemManaged = item.type === "folder" && !!(item as { systemKey?: string | null }).systemKey;
  const canRename = !isSystemManaged && (item.type === "folder" || item.type === "doc" || item.type === "file" || item.type === "form" || item.type === "agreement");
  // drive-spaces: email templates are now managed by Drive (rename/move/delete
  // allowed); agreements and rubrics remain placement-locked. System-managed
  // folders (systemKey) are auto-filed and stay put — matching the drag gate.
  const canMove =
    !isSystemManaged &&
    item.type !== "agreement" &&
    item.type !== "rubric";
  const canDelete = !isSystemManaged && (item.type === "folder" || item.type === "doc" || item.type === "file" || item.type === "form");
  const canFavorite = item.type === "doc" || item.type === "folder";
  // Sharing via PageShare works for Page-backed items only (doc and folder).
  // Files, forms, agreements, rubrics, email templates have separate or no
  // sharing surfaces, so the Share option is intentionally omitted for them.
  const canShare = (item.type === "doc" || item.type === "folder") && !!actions.onShare;
  // Partner visibility toggle: applies to docs and files in project-scoped Drive.
  // partnerVisible lives on the doc/file variant — access it via cast to avoid
  // widening the union type unnecessarily.
  const itemPartnerVisible = (item as { partnerVisible?: boolean | null }).partnerVisible ?? false;
  const canTogglePartner = !!onTogglePartnerVisible && (item.type === "doc" || item.type === "file");
  return (
    <>
      <Menu.Item icon={<FolderOpen className="h-3.5 w-3.5" />} onSelect={onOpen}>
        Open
      </Menu.Item>
      {canFavorite && onToggleFavorite && (
        <Menu.Item
          icon={<Star className={`h-3.5 w-3.5 ${item.favorited ? "fill-current text-accent-coral" : ""}`} />}
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
    <Menu
      align="right"
      ariaLabel="Item actions"
      trigger={
        <button
          type="button"
          data-testid={`drive-item-actions-${item.id}`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      }
    >
      {itemMenuItems(item, actions, onOpen, onToggleFavorite, onTogglePartnerVisible)}
    </Menu>
  );
}

// Inline favorite star (doc/folder only).
function FavoriteButton({
  item,
  onToggleFavorite,
}: {
  item: DriveItem;
  onToggleFavorite?: (item: DriveItem) => void;
}) {
  if ((item.type !== "doc" && item.type !== "folder") || !onToggleFavorite) {
    return <span className="w-6 shrink-0" aria-hidden="true" />;
  }
  return (
    <button
      type="button"
      aria-label={item.favorited ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={item.favorited ?? false}
      onClick={(e) => {
        e.stopPropagation();
        onToggleFavorite(item);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`shrink-0 rounded p-1 transition-opacity ${
        item.favorited
          ? "text-accent-coral opacity-100"
          : "text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
      }`}
    >
      <Star className={`h-3.5 w-3.5 ${item.favorited ? "fill-current" : ""}`} />
    </button>
  );
}

const GRID_COLUMNS = "minmax(0,1fr) 9rem 5rem 3.75rem";

// ── Miller column types ──────────────────────────────────────────────────────

// Each "level" in the column stack is either the scope root or a folder inside
// a scope. The column renders that level's children.
type ColumnLevel =
  | { kind: "root" }
  | { kind: "scope"; scopeId: string; folderId: string | null };

// The selected "path" through the column tree: the sequence of levels opened,
// plus the id of the row highlighted at each level.
type ColumnSelection = {
  levels: ColumnLevel[];
  /** The row id highlighted at each level (parallel to `levels`). */
  highlightedIds: (string | null)[];
  /** If a leaf is highlighted, it lives at this level index. */
  leafLevelIdx: number | null;
  /** The highlighted leaf item (populated when a leaf row is selected). */
  selectedLeaf: DriveItem | null;
};

function initialColumnSelection(
  currentScopeId: string | null,
  currentFolderId: string | null,
  scopes: DriveTreeScope[],
): ColumnSelection {
  if (!currentScopeId) {
    return { levels: [{ kind: "root" }], highlightedIds: [null], leafLevelIdx: null, selectedLeaf: null };
  }
  const scope = scopes.find((s) => s.id === currentScopeId);
  if (!scope) {
    return { levels: [{ kind: "root" }], highlightedIds: [null], leafLevelIdx: null, selectedLeaf: null };
  }

  // Build the path of folder crumbs (root → currentFolderId, inclusive).
  // e.g. navigating to FolderB inside FolderA: crumbs = [{id:folderA}, {id:folderB}]
  const crumbs = crumbsFor(scope.items, currentFolderId);

  // Column layout:
  //   Col 0: all scopes              highlighted = scopeId
  //   Col 1: scope root (folderId=null)  highlighted = crumbs[0].id (or null)
  //   Col 2: folderId=crumbs[0].id   highlighted = crumbs[1].id (or null)
  //   ...
  //   Col k: folderId=crumbs[k-2].id highlighted = crumbs[k-1].id (or null)
  //   Col N: folderId=currentFolderId highlighted = null  (the "current" column)
  //
  // When currentFolderId is null, crumbs is empty, so we only have col 0 + col 1.
  const levels: ColumnLevel[] = [
    { kind: "root" },
    { kind: "scope", scopeId: currentScopeId, folderId: null },
  ];
  // col 0 highlights the scope; col 1 highlights crumbs[0] if we're inside a folder
  const highlightedIds: (string | null)[] = [currentScopeId, crumbs.length > 0 ? crumbs[0].id : null];

  // For each crumb (they are in root→leaf order), open a column showing that
  // crumb's parent folder's children, and highlight the crumb itself.
  // crumbs[0] is already highlighted at col 1 (scope root). Starting from
  // crumbs[1] we need additional columns.
  for (let i = 1; i < crumbs.length; i++) {
    levels.push({ kind: "scope", scopeId: currentScopeId, folderId: crumbs[i - 1].id });
    highlightedIds.push(crumbs[i].id);
  }

  // The final column shows the contents of currentFolderId (nothing highlighted).
  if (currentFolderId !== null) {
    levels.push({ kind: "scope", scopeId: currentScopeId, folderId: currentFolderId });
    highlightedIds.push(null);
  }

  return { levels, highlightedIds, leafLevelIdx: null, selectedLeaf: null };
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
  onOpenItem,
  onMove,
  getScopeActions,
  onToggleFavorite,
  onBulkDelete,
  onBulkMove,
  onMoveToScope,
  onUploadFiles,
  filterControl,
  newMenu,
  tagChips,
  tagFilter,
  onShareItem,
  embeddedScopeId,
  onTogglePartnerVisible,
  hasActivePartner,
}: DriveBrowserProps) {
  const currentScope = useMemo(
    () => scopes.find((s) => s.id === currentScopeId) ?? null,
    [scopes, currentScopeId],
  );

  // Share dialog state — the item currently targeted for in-place sharing.
  const [shareTarget, setShareTarget] = useState<{ id: string; title: string; workspaceType: string } | null>(null);

  // Wrap the hub's getScopeActions to inject the in-place Share handler.
  // Sharing only applies to doc/folder (Page-backed) items; the wrapper passes
  // onShare so itemMenuItems and the leaf toolbar can show it without the hub
  // needing to know the browser owns the ShareDialog state.
  function getInternalScopeActions(scopeId: string): RowActions {
    const base = getScopeActions(scopeId);
    return {
      ...base,
      onShare: (item: DriveItem) => {
        if (item.type !== "doc" && item.type !== "folder") return;
        // workspaceType is not on DriveItem directly; infer from the scope id
        // so the ShareDialog can show the correct audience label (Lab/Project/Member).
        const scope = scopes.find((s) => s.id === scopeId);
        const wt =
          !scope || scope.id === "lab" || scope.id === "core" || scope.id === "hiring"
            ? "Lab"
            : scope.id === "mine"
              ? "Member"
              : "Project";
        setShareTarget({ id: item.id, title: item.title || "Untitled", workspaceType: wt });
        onShareItem?.(item);
      },
    };
  }

  // ── Legacy list/grid state (for non-column views) ──────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  const [viewMode, setViewMode] = useState<ViewMode>("columns");
  const [uploadOver, setUploadOver] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DriveItem | null>(null);
  const dragDepth = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // ── Miller column state ────────────────────────────────────────────────────
  const [colSel, setColSel] = useState<ColumnSelection>(() =>
    initialColumnSelection(currentScopeId, currentFolderId, scopes),
  );
  const columnsContainerRef = useRef<HTMLDivElement | null>(null);

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
    try {
      window.localStorage.setItem("dali_drive_view", v);
    } catch {
      /* ignore */
    }
  }

  // Sync column selection when the URL-driven location changes (e.g. breadcrumb
  // click, back/forward, programmatic navigate).
  useEffect(() => {
    setColSel(initialColumnSelection(currentScopeId, currentFolderId, scopes));
  }, [currentScopeId, currentFolderId, scopes]);

  // Auto-scroll the columns container to the right after each column is added.
  useEffect(() => {
    const el = columnsContainerRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [colSel.levels.length]);

  // Reset list/grid selection when the location or search changes.
  useEffect(() => {
    setSelected(new Set());
    setAnchorId(null);
    setActiveId(null);
  }, [currentScopeId, currentFolderId, search]);

  const os = useFeatureFlag("os-redesign");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const suppressClickRef = useRef(false);

  // "searching" is really "showing flat results across every drive", which a
  // tag selection does just as much as a text query — the tree can't express
  // "tagged X" the way a folder path expresses location.
  const searching = search.trim().length > 0 || !!tagFilter;
  const hits = useMemo(
    () => (searching ? searchAll(scopes, search, typeFilter, tagFilter) : []),
    [searching, scopes, search, typeFilter, tagFilter],
  );

  const folderCrumbs = currentScope ? crumbsFor(currentScope.items, currentFolderId) : [];

  const listing = useMemo(() => {
    if (!currentScope) return [];
    const kids = childrenAt(currentScope.items, currentFolderId).filter(
      (it) => typeFilter === "all" || it.type === "folder" || it.type === typeFilter,
    );
    return sortItems(kids, sort.key, sort.dir);
  }, [currentScope, currentFolderId, typeFilter, sort]);

  const orderedIds = useMemo(() => {
    if (searching) return hits.map((h) => h.item.id);
    if (!currentScope) return scopes.map((s) => s.id);
    return listing.map((i) => i.id);
  }, [searching, hits, currentScope, scopes, listing]);

  // Items backing the current selection. In column view the selectable pool is
  // the union of items across the open columns; in list/grid it's the listing.
  const selectedItems = useMemo(() => {
    if (searching) {
      // In search the selectable pool is the flat hit list (across scopes), so
      // the bulk bar and details pane act on the matched items — not the folder
      // the viewer happened to be in when they started searching.
      const pool = new Map<string, DriveItem>();
      for (const h of hits) pool.set(h.item.id, h.item);
      return [...pool.values()].filter((i) => selected.has(i.id));
    }
    if (viewMode === "columns") {
      const pool = new Map<string, DriveItem>();
      for (const level of colSel.levels) {
        for (const it of itemsForLevel(level)) pool.set(it.id, it);
      }
      return [...pool.values()].filter((i) => selected.has(i.id));
    }
    return listing.filter((i) => selected.has(i.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, hits, viewMode, colSel, listing, selected]);

  // ── List/Grid Selection ────────────────────────────────────────────────────
  function selectOnly(id: string) {
    setSelected(new Set([id]));
    setAnchorId(id);
    setActiveId(id);
  }
  function handleRowClick(id: string, e: ReactMouseEvent) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setAnchorId(id);
      setActiveId(id);
    } else if (e.shiftKey && anchorId) {
      const a = orderedIds.indexOf(anchorId);
      const b = orderedIds.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(orderedIds.slice(lo, hi + 1)));
      }
      setActiveId(id);
    } else {
      selectOnly(id);
    }
  }

  // ── Open / navigate (list/grid mode) ─────────────────────────────────────
  function openById(id: string) {
    if (searching) {
      const hit = hits.find((h) => h.item.id === id);
      if (hit) {
        if (hit.item.type === "folder") onNavigate(hit.scope.id, hit.item.id);
        else onOpenItem(hit.item);
      }
      return;
    }
    if (!currentScope) {
      onNavigate(id, null);
      return;
    }
    const item = listing.find((i) => i.id === id);
    if (!item) return;
    if (item.type === "folder") onNavigate(currentScope.id, item.id);
    else onOpenItem(item);
  }

  // ── Keyboard navigation (list/grid mode) ──────────────────────────────────
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (orderedIds.length === 0) return;
    const idx = activeId ? orderedIds.indexOf(activeId) : -1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = orderedIds[Math.min(idx + 1, orderedIds.length - 1)] ?? orderedIds[0];
      selectOnly(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = orderedIds[Math.max(idx - 1, 0)] ?? orderedIds[0];
      selectOnly(next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeId) openById(activeId);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      if (!currentScope) return;
      if (currentFolderId) {
        const parent = currentScope.items.find((i) => i.id === currentFolderId)?.parentFolderId ?? null;
        onNavigate(currentScope.id, parent);
      } else {
        onNavigate(null, null);
      }
    } else if (e.key === "Escape") {
      setSelected(new Set());
      setActiveId(null);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(orderedIds));
    } else if (e.key === "F2" && activeId) {
      // Rename the active row — resolve from the search hit (with its own scope)
      // when searching, else from the current scope's listing.
      if (searching) {
        const hit = hits.find((h) => h.item.id === activeId);
        if (hit) getInternalScopeActions(hit.scope.id).onRename(hit.item);
      } else if (currentScope) {
        const item = listing.find((i) => i.id === activeId);
        if (item) getInternalScopeActions(currentScope.id).onRename(item);
      }
    }
  }

  // ── dnd-kit (internal move) ──────────────────────────────────────────────
  function handleDragStart(e: DragStartEvent) {
    const data = e.active.data.current as { item: DriveItem } | undefined;
    setActiveDrag(data?.item ?? null);
  }
  function handleDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    suppressClickRef.current = true;
    setTimeout(() => (suppressClickRef.current = false), 0);
    const src = e.active.data.current as { item: DriveItem; scopeId: string } | undefined;
    const dest = e.over?.data.current as { destFolderId?: string | null; destScopeId?: string } | undefined;
    if (!src || !dest) return;
    // Cross-drive drop: item dragged onto a scope row in column 0.
    if (dest.destScopeId && dest.destFolderId === undefined) {
      if (dest.destScopeId !== src.scopeId) {
        onMoveToScope?.(src.scopeId, dest.destScopeId, src.item);
      }
      return;
    }
    // Folder-drop (existing logic): same-drive internal move.
    if (!currentScope) return;
    if (src.item.type === "folder" && dest.destFolderId !== null && dest.destFolderId !== undefined) {
      if (folderDescendants(currentScope.items, src.item.id).has(dest.destFolderId)) return;
    }
    if (src.item.parentFolderId === dest.destFolderId) return;
    onMove(currentScope.id, src.item, dest.destFolderId ?? null);
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
  }
  function onFileDragOver(e: React.DragEvent) {
    if (!canUpload || !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  function onFileDragLeave() {
    if (!canUpload) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setUploadOver(false);
  }
  function onFileDrop(e: React.DragEvent) {
    if (!canUpload) return;
    e.preventDefault();
    dragDepth.current = 0;
    setUploadOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length && onUploadFiles) onUploadFiles(files);
  }

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  // Bulk actions apply to a scope's listing AND to multi-selected search results
  // (search offers the same interactions as browsing).
  const showBulk = selected.size > 1 && (searching || !!currentScope);

  // ── Miller column handlers ─────────────────────────────────────────────────

  // Click a scope row in column 0 → highlight it, open column 1 with scope root.
  function handleScopeClick(scopeId: string) {
    onNavigate(scopeId, null);
    setColSel({
      levels: [
        { kind: "root" },
        { kind: "scope", scopeId, folderId: null },
      ],
      highlightedIds: [scopeId, null],
      leafLevelIdx: null,
      selectedLeaf: null,
    });
  }

  // Double-click scope = navigate there (same as click, already navigated above).
  function handleScopeDblClick(scopeId: string) {
    onNavigate(scopeId, null);
  }

  // Click a row inside a column: either drill into folder or highlight leaf.
  // Cmd/Ctrl- or Shift-click multi-selects within that column (like list/grid)
  // instead of navigating, driving the same bulk bar.
  function handleColumnRowClick(levelIdx: number, item: DriveItem, scopeId: string, e?: ReactMouseEvent) {
    if (e && (e.metaKey || e.ctrlKey)) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      setAnchorId(item.id);
      return;
    }
    if (e && e.shiftKey && anchorId) {
      const ids = itemsForLevel(colSel.levels[levelIdx]).map((i) => i.id);
      const a = ids.indexOf(anchorId);
      const b = ids.indexOf(item.id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setSelected(new Set(ids.slice(lo, hi + 1)));
        return;
      }
    }
    // Plain click: drop any multi-selection, then navigate/highlight as before.
    if (selected.size > 0) setSelected(new Set());
    setAnchorId(item.id);
    if (item.type === "folder") {
      // Drill into folder: truncate anything to the right of this column, open
      // a new column for this folder's children, and update URL.
      const newFolderId = item.id;

      const truncatedLevels = colSel.levels.slice(0, levelIdx + 1);
      const truncatedHighlights = colSel.highlightedIds.slice(0, levelIdx + 1);
      truncatedHighlights[levelIdx] = item.id;

      // Add the new column showing this folder's children.
      truncatedLevels.push({ kind: "scope", scopeId, folderId: newFolderId });
      truncatedHighlights.push(null);

      setColSel({
        levels: truncatedLevels,
        highlightedIds: truncatedHighlights,
        leafLevelIdx: null,
        selectedLeaf: null,
      });
      onNavigate(scopeId, newFolderId);
    } else {
      // Leaf: highlight in this column, truncate columns to the right, show toolbar.
      const truncatedLevels = colSel.levels.slice(0, levelIdx + 1);
      const truncatedHighlights = colSel.highlightedIds.slice(0, levelIdx + 1);
      truncatedHighlights[levelIdx] = item.id;
      setColSel({
        levels: truncatedLevels,
        highlightedIds: truncatedHighlights,
        leafLevelIdx: levelIdx,
        selectedLeaf: item,
      });
    }
  }

  // Double-click a leaf → open it. Folders are opened via onOpenItem too, which
  // drills into them (see the route's onOpenItem); guarding here is unnecessary
  // but harmless — a double-click on a folder in columns already drilled on the
  // preceding single click.
  function handleColumnRowDblClick(item: DriveItem) {
    if (item.type !== "folder") {
      onOpenItem(item);
    }
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
      (it) => typeFilter === "all" || it.type === "folder" || it.type === typeFilter,
    );
    return sortItems(kids, sort.key, sort.dir);
  }

  // Get the scope id for a given column level (for actions).
  function scopeIdForLevel(level: ColumnLevel): string | null {
    if (level.kind !== "scope") return null;
    return level.scopeId;
  }

  // ── Leaf toolbar actions ───────────────────────────────────────────────────
  const { selectedLeaf } = colSel;
  let leafScopeId: string | null = null;
  if (colSel.leafLevelIdx !== null) {
    leafScopeId = scopeIdForLevel(colSel.levels[colSel.leafLevelIdx]);
  }
  const leafActions = leafScopeId ? getInternalScopeActions(leafScopeId) : null;

  // Signal ①: system-managed leaf folders hide Delete/Rename in the toolbar too.
  const leafIsSystemManaged =
    !!selectedLeaf &&
    selectedLeaf.type === "folder" &&
    !!(selectedLeaf as { systemKey?: string | null }).systemKey;
  const canLeafRename =
    !leafIsSystemManaged &&
    selectedLeaf &&
    (selectedLeaf.type === "folder" ||
      selectedLeaf.type === "doc" ||
      selectedLeaf.type === "file" ||
      selectedLeaf.type === "form" ||
      selectedLeaf.type === "agreement");
  // drive-spaces: email templates are movable in Drive (card-grid list retired).
  const canLeafMove =
    !!selectedLeaf &&
    selectedLeaf.type !== "agreement" &&
    selectedLeaf.type !== "rubric";
  const canLeafDelete =
    !leafIsSystemManaged &&
    selectedLeaf &&
    (selectedLeaf.type === "folder" ||
      selectedLeaf.type === "doc" ||
      selectedLeaf.type === "file" ||
      selectedLeaf.type === "form");
  // Download: only for files with an href.
  const canLeafDownload = selectedLeaf && selectedLeaf.type === "file";
  // Share: page-backed items only (doc and folder). Folders now support sharing
  // via PageShare, which was previously impossible from the Drive surface.
  const canLeafShare =
    !!selectedLeaf &&
    (selectedLeaf.type === "doc" || selectedLeaf.type === "folder") &&
    !!leafActions?.onShare;

  return (
    <DriveScale.Provider value={os}>
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-3" data-testid="drive-browser" onClick={() => setSelected(new Set())}>
        {/* The trail gets its own line. Sharing the toolbar row, it was the one
            flexible item among half a dozen shrink-0 controls, so it took
            whatever width was left over — at a couple of levels deep that was
            "Pro… › Hood M…", which is not a hierarchy anyone can read. */}
        <Breadcrumb
          currentScope={currentScope}
          folderCrumbs={folderCrumbs}
          onNavigate={onNavigate}
          dragging={!!activeDrag}
        />

        {/* ── Toolbar row: filter · search · view · New ── */}
        <div className="flex items-center gap-3 flex-wrap">
          {filterControl}

          <div className="relative w-full sm:w-56 shrink-0">
            <Search
              className={cn(
                "pointer-events-none absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground",
                os ? "left-3.5" : "left-2.5",
              )}
            />
            <input
              type="search"
              value={search}
              data-testid="drive-search"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search Drive"
              className={cn(
                "w-full border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent-coral/40",
                os ? "rounded-full pl-9 pr-9 py-2.5" : "rounded-md pl-8 pr-8 py-1.5",
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
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground",
                  os ? "right-3" : "right-2",
                )}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* View toggle — columns / list / grid */}
          <div
            className={cn(
              "inline-flex border border-border overflow-hidden shrink-0",
              os ? "rounded-full bg-card" : "rounded-md",
            )}
          >
            <Tooltip content="Column view">
              <button
                type="button"
                data-testid="drive-view-columns"
                aria-label="Column view"
                aria-pressed={viewMode === "columns"}
                onClick={(e) => {
                  e.stopPropagation();
                  changeView("columns");
                }}
                className={cn(
                  os ? "px-3.5 py-2.5" : "p-1.5",
                  viewMode === "columns"
                    ? os
                      ? "bg-os-container text-foreground"
                      : "bg-accent-coral/10 text-accent-coral"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                <Columns className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip content="List view">
              <button
                type="button"
                data-testid="drive-view-list"
                aria-label="List view"
                aria-pressed={viewMode === "list"}
                onClick={(e) => {
                  e.stopPropagation();
                  changeView("list");
                }}
                className={cn(
                  os ? "px-3.5 py-2.5" : "p-1.5",
                  viewMode === "list"
                    ? os
                      ? "bg-os-container text-foreground"
                      : "bg-accent-coral/10 text-accent-coral"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                <ListIcon className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip content="Grid view">
              <button
                type="button"
                data-testid="drive-view-grid"
                aria-label="Grid view"
                aria-pressed={viewMode === "grid"}
                onClick={(e) => {
                  e.stopPropagation();
                  changeView("grid");
                }}
                className={cn(
                  os ? "px-3.5 py-2.5" : "p-1.5",
                  viewMode === "grid"
                    ? os
                      ? "bg-os-container text-foreground"
                      : "bg-accent-coral/10 text-accent-coral"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3">{newMenu}</div>
        </div>

        {tagChips}

        {/* ── Bulk action bar (multi-select, all views) ── */}
        {showBulk && (
          <div
            className={cn(
              "flex items-center gap-3 rounded-md border border-accent-coral/40 bg-accent-coral/5 px-3 py-1.5",
              os ? "text-base" : "text-sm",
            )}
            data-testid="drive-bulk-bar"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="font-medium text-foreground">{selected.size} selected</span>
            {onBulkMove && (
              <button
                type="button"
                data-testid="drive-bulk-move"
                onClick={() => onBulkMove(selectedItems)}
                className="inline-flex items-center gap-1 text-foreground hover:text-accent-coral"
              >
                <FolderInput className="w-3.5 h-3.5" /> Move
              </button>
            )}
            {onBulkDelete && (
              <button
                type="button"
                onClick={() => onBulkDelete(selectedItems)}
                className="inline-flex items-center gap-1 text-destructive hover:text-destructive/80"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
        )}

        {/* ── Column-view leaf toolbar (shown above columns when a leaf is selected) ── */}
        {viewMode === "columns" && !searching && selectedLeaf && leafActions && (
          <div
            className={cn(
              "flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5",
              os ? "text-base" : "text-sm",
            )}
            data-testid="drive-leaf-toolbar"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="flex items-center gap-1.5 min-w-0 flex-1">
              {itemIcon(selectedLeaf)}
              <span className="font-medium text-foreground truncate">{selectedLeaf.title || "Untitled"}</span>
              <span className={cn("text-muted-foreground shrink-0", os ? "text-sm" : "text-xs")}>
                {kindLabel(selectedLeaf)}
              </span>
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {canLeafDownload && selectedLeaf.href && (
                <a
                  href={selectedLeaf.href}
                  download
                  data-testid="drive-leaf-download"
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    os ? "text-sm" : "text-xs",
                  )}
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
              )}
              {canLeafRename && (
                <button
                  type="button"
                  data-testid="drive-leaf-rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    leafActions.onRename(selectedLeaf);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    os ? "text-sm" : "text-xs",
                  )}
                >
                  <Pencil className="w-3.5 h-3.5" /> Rename
                </button>
              )}
              {canLeafMove && (
                <button
                  type="button"
                  data-testid="drive-leaf-move"
                  onClick={(e) => {
                    e.stopPropagation();
                    leafActions.onRequestMove(selectedLeaf);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    os ? "text-sm" : "text-xs",
                  )}
                >
                  <FolderInput className="w-3.5 h-3.5" /> Move
                </button>
              )}
              {/* Share: opens the ShareDialog in-place for docs and folders.
                  Previously this was an <a> that navigated away; now it mounts
                  ShareDialog directly so the user never leaves Drive. Folder
                  sharing (PageShare) is now reachable for the first time. */}
              {canLeafShare && (
                <button
                  type="button"
                  data-testid="drive-leaf-share"
                  onClick={(e) => {
                    e.stopPropagation();
                    leafActions!.onShare!(selectedLeaf);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    os ? "text-sm" : "text-xs",
                  )}
                >
                  <Share2 className="w-3.5 h-3.5" /> Share
                </button>
              )}
              {canLeafDelete && (
                <button
                  type="button"
                  data-testid="drive-leaf-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    leafActions.onDelete(selectedLeaf);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-destructive hover:bg-destructive/10",
                    os ? "text-sm" : "text-xs",
                  )}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Body ── */}
        <div>
          {viewMode === "columns" && !searching ? (
            /* ── MILLER COLUMNS ─────────────────────────────────────────── */
            <div
              ref={columnsContainerRef}
              className="flex-1 min-w-0 rounded-lg border border-border bg-card overflow-x-auto"
              onDragEnter={onFileDragEnter}
              onDragOver={onFileDragOver}
              onDragLeave={onFileDragLeave}
              onDrop={onFileDrop}
              onClick={() =>
                setColSel((prev) => ({ ...prev, selectedLeaf: null, leafLevelIdx: null }))
              }
              data-testid="drive-columns"
            >
              {uploadOver && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent-coral bg-accent-coral/10">
                  <span className="flex items-center gap-2 text-sm font-medium text-accent-coral">
                    <Upload className="w-4 h-4" /> Drop files to upload
                  </span>
                </div>
              )}
              {/* No height of its own: the row is as tall as its tallest
                  column, which caps itself (see MillerColumn), so a shallow
                  Drive doesn't paint an empty panel down to the fold. */}
              <div className="flex divide-x divide-border/60">
                {/* Column 0: scope list — hidden in embedded mode (the user is
                    already inside the project context, no cross-scope nav). */}
                {!embeddedScopeId && (
                  <MillerColumn
                    testid="drive-col-root"
                    isEmpty={scopes.length === 0}
                    emptyMessage="No drives available."
                  >
                    {scopes.map((scope) => {
                      const isHighlighted = colSel.highlightedIds[0] === scope.id;
                      return (
                        <ColumnScopeRow
                          key={scope.id}
                          scope={scope}
                          isHighlighted={isHighlighted}
                          isDragging={!!activeDrag}
                          onClick={() => handleScopeClick(scope.id)}
                          onDoubleClick={() => handleScopeDblClick(scope.id)}
                        />
                      );
                    })}
                  </MillerColumn>
                )}

                {/* Columns 1+: scope/folder contents */}
                {colSel.levels.slice(1).map((level, relIdx) => {
                  const levelIdx = relIdx + 1;
                  const sId = scopeIdForLevel(level);
                  const items = itemsForLevel(level);
                  const highlightedId = colSel.highlightedIds[levelIdx] ?? null;
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
                      emptyMessage="This folder is empty."
                    >
                      {items.map((item) => {
                        const isHighlighted = highlightedId === item.id;
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
                              isHighlighted={isHighlighted}
                              isSelected={selected.has(item.id)}
                              scopeActions={scopeActions}
                              onToggleFavorite={onToggleFavorite}
                              onTogglePartnerVisible={partnerToggle}
                              onClick={(e) => { if (sId) handleColumnRowClick(levelIdx, item, sId, e); }}
                              onDoubleClick={() => handleColumnRowDblClick(item)}
                              onOpen={() => onOpenItem(item)}
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
              onKeyDown={onKeyDown}
              onDragEnter={onFileDragEnter}
              onDragOver={onFileDragOver}
              onDragLeave={onFileDragLeave}
              onDrop={onFileDrop}
              className="relative flex-1 min-w-0 rounded-lg border border-border bg-card overflow-hidden focus:outline-none focus:ring-1 focus:ring-accent-coral/30"
            >
              {uploadOver && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent-coral bg-accent-coral/10">
                  <span className="flex items-center gap-2 text-sm font-medium text-accent-coral">
                    <Upload className="w-4 h-4" /> Drop files to upload
                  </span>
                </div>
              )}

              {searching ? (
                <SearchResults
                  hits={hits}
                  selected={selected}
                  onRowClick={handleRowClick}
                  onOpen={openById}
                  getScopeActions={getInternalScopeActions}
                  onToggleFavorite={onToggleFavorite}
                />
              ) : !currentScope ? (
                // In embedded mode the scope is always pre-selected, so this
                // branch only renders in the full /drive browser. Embedded mode
                // always has a currentScope because currentScopeId = embeddedScopeId.
                <ScopeList
                  scopes={scopes}
                  selected={selected}
                  onRowClick={handleRowClick}
                  onOpen={openById}
                />
              ) : (
                <ScopeContents
                  scope={currentScope}
                  listing={listing}
                  viewMode={viewMode === "grid" ? "grid" : "list"}
                  sort={sort}
                  onToggleSort={toggleSort}
                  selected={selected}
                  activeId={activeId}
                  onRowClick={handleRowClick}
                  onOpen={openById}
                  onMove={onMove}
                  actions={getInternalScopeActions(currentScope.id)}
                  onToggleFavorite={onToggleFavorite}
                  onTogglePartnerVisible={
                    hasActivePartner && onTogglePartnerVisible ? onTogglePartnerVisible : undefined
                  }
                  dragging={!!activeDrag}
                  suppressClickRef={suppressClickRef}
                />
              )}
            </div>
          )}

        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag && (
          <div
            className={cn(
              "flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 shadow-lg",
              os ? "text-base" : "text-sm",
            )}
          >
            {itemIcon(activeDrag)}
            <span className="font-medium text-foreground">{activeDrag.title || "Untitled"}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>

    {/* In-place Share dialog — mounted outside DndContext so DnD events don't
        bleed through; keyed by item id so state resets on a different target. */}
    {shareTarget && (
      <ShareDialog
        key={shareTarget.id}
        page={shareTarget}
        open={true}
        onClose={() => setShareTarget(null)}
      />
    )}
    </DriveScale.Provider>
  );
}

// ── Column view: droppable scope row (column 0) ──────────────────────────────

function ColumnScopeRow({
  scope,
  isHighlighted,
  isDragging,
  onClick,
  onDoubleClick,
}: {
  scope: DriveTreeScope;
  isHighlighted: boolean;
  isDragging: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const t = useDriveText();
  const isCore = scope.id === "core";
  const isHiring = scope.id === "hiring";
  // Synthetic group scopes ("projects"/"education") are not valid drop targets —
  // dropping on the group row is ambiguous (which project?). Only individual
  // project folders inside the group accept drops via the normal folder-drop path.
  const isGroupScope = scope.id === "projects" || scope.id === "education";
  const isProject = scope.id !== "mine" && scope.id !== "lab" && !isCore && !isHiring && !isGroupScope;
  const label =
    scope.id === "mine" ? "My Drive" : scope.id === "lab" ? "Lab" : scope.label;

  const drop = useDroppable({
    id: `scopedrop::${scope.id}`,
    data: { destScopeId: scope.id },
    // Disable dropping onto the group scope rows; also disables when not dragging.
    disabled: !isDragging || isGroupScope,
  });

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
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
      className={`group flex items-center gap-2 px-3 py-2 ${t.row} cursor-default select-none ${
        drop.isOver
          ? "ring-2 ring-accent-coral ring-inset bg-accent-coral/10 text-accent-coral"
          : isHighlighted
            ? "bg-accent-coral/10 text-accent-coral"
            : "hover:bg-muted/50 text-foreground"
      }`}
    >
      {scopeIcon(scope)}
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {audienceChip}
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 opacity-60" />
    </div>
  );
}

// ── Column view: draggable item row (columns 1+) ──────────────────────────────

function ColumnItemRow({
  item,
  scopeId,
  isHighlighted,
  isSelected,
  scopeActions,
  onToggleFavorite,
  onTogglePartnerVisible,
  onClick,
  onDoubleClick,
  onOpen,
}: {
  item: DriveItem;
  scopeId: string | null;
  isHighlighted: boolean;
  isSelected: boolean;
  scopeActions: RowActions | null;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
  onClick: (e: ReactMouseEvent) => void;
  onDoubleClick: () => void;
  onOpen: () => void;
}) {
  const t = useDriveText();
  const isFolder = item.type === "folder";
  const isManaged = item.type === "agreement" || item.type === "rubric" || item.type === "emailTemplate";
  // Signal ①: system-managed folders (systemKey set) are also non-draggable.
  const isSystemManaged =
    isFolder && !!(item as { systemKey?: string | null }).systemKey;
  const drag = useDraggable({
    id: `col::${scopeId}::${item.id}`,
    data: { item, scopeId },
    disabled: isManaged || isSystemManaged || !scopeId,
  });

  return (
    <div
      ref={drag.setNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      data-testid={`drive-item-${item.type}-${item.id}`}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
      className={`group flex items-center gap-2 px-3 py-2 ${t.row} cursor-default select-none ${
        drag.isDragging ? "opacity-40" : ""
      } ${
        isHighlighted || isSelected
          ? "bg-accent-coral/10 text-accent-coral"
          : "hover:bg-muted/50 text-foreground"
      }`}
    >
      {itemIcon(item)}
      <span className="min-w-0 flex-1 truncate font-medium">
        {item.title || "Untitled"}
      </span>
      {/* Signal ②: process linkage pill. */}
      {item.linkedProcess && (
        <ProcessLinkPill label={item.linkedProcess.label} href={item.linkedProcess.href} />
      )}
      {/* Signal ①: "Managed" chip revealed on hover for system-keyed folders.
          Reuses the PageRow opacity-reveal pattern from home.tsx:797. */}
      {isSystemManaged && (
        <Tooltip
          content="This folder is managed by the system. Rename and delete are unavailable to keep internal processes consistent."
          variant="rich"
        >
          <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            Managed
          </span>
        </Tooltip>
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
      {/* Inline star for favorites */}
      {(item.type === "doc" || item.type === "folder") && onToggleFavorite && (
        <button
          type="button"
          aria-label={item.favorited ? "Remove from favorites" : "Add to favorites"}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(item); }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className={`shrink-0 rounded p-0.5 transition-opacity ${
            item.favorited
              ? "text-accent-coral opacity-100"
              : "text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
          }`}
        >
          <Star className={`h-3.5 w-3.5 ${item.favorited ? "fill-current" : ""}`} />
        </button>
      )}
      {/* Actions menu */}
      {scopeActions && (
        <RowActionsMenu
          item={item}
          actions={scopeActions}
          onOpen={onOpen}
          onToggleFavorite={onToggleFavorite}
          onTogglePartnerVisible={onTogglePartnerVisible}
        />
      )}
      {isFolder && (
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 opacity-60" />
      )}
    </div>
  );
}

// ── Miller column wrapper ─────────────────────────────────────────────────────

function MillerColumn({
  children,
  testid,
  isEmpty,
  emptyMessage,
}: {
  children: ReactNode;
  testid?: string;
  isEmpty: boolean;
  emptyMessage: string;
}) {
  const t = useDriveText();
  return (
    <div
      data-testid={testid}
      // flex-1 so the open columns expand to fill the width (and share it as
      // more open); min-width keeps each readable and lets the row scroll
      // horizontally once it's deep enough to overflow.
      // The cap is a column's own, not the frame's: it leaves the page chrome
      // above visible and scrolls this column past it, while a column with
      // little in it stays as short as its rows. Columns stretch to the tallest
      // of them, so the frame ends where the content does.
      className="flex flex-1 flex-col overflow-y-auto min-w-[14rem] max-h-[calc(100vh-14rem)]"
    >
      {isEmpty ? (
        <p className={`px-3 py-6 text-center ${t.meta} text-muted-foreground italic`}>{emptyMessage}</p>
      ) : (
        <div className="flex flex-col divide-y divide-border/50">{children}</div>
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
}: {
  currentScope: DriveTreeScope | null;
  folderCrumbs: { id: string; title: string }[];
  onNavigate: (scopeId: string | null, folderId: string | null) => void;
  dragging: boolean;
}) {
  const t = useDriveText();
  // Under the redesign the page renders its own "Drive" h1, so the root crumb
  // goes entirely rather than repeating the word right beneath it — the scope
  // crumb leads, and the h1 is the way back to the root.
  const os = useContext(DriveScale);
  // On its own row an empty trail would still spend a row gap. Off-flag the
  // root crumb always renders, so this only bites at a drive's top level under
  // the redesign — where there is deliberately nothing to show.
  if (os && folderCrumbs.length === 0) return null;
  const collapse = folderCrumbs.length > 3;
  const hidden = collapse ? folderCrumbs.slice(0, folderCrumbs.length - 2) : [];
  const shown = collapse ? folderCrumbs.slice(folderCrumbs.length - 2) : folderCrumbs;

  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="drive-breadcrumb"
      className={`flex flex-wrap items-center gap-1 min-w-0 ${t.row}`}
    >
      {!os && (
        <button
          type="button"
          data-testid="drive-crumb-root"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(null, null);
          }}
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-muted/50"
        >
          <HardDrive className="w-4 h-4 text-accent-coral" />
          Drive
        </button>
      )}
      {/* The scope crumb only earns its place once you're inside a folder,
          where it is the way back up. Sitting at the scope root under the
          redesign it led the trail with no chevron and nothing after it — a
          lone button beneath the page title whose only destination was the
          page you were already on. It still leads the trail off-flag, where
          the root "Drive" crumb above makes it read as a trail. */}
      {currentScope && (!os || folderCrumbs.length > 0) && (
        <Crumb
          label={currentScope.id === "mine" ? "My Drive" : currentScope.id === "lab" ? "Lab" : currentScope.label}
          testid="drive-crumb-scope"
          scopeId={currentScope.id}
          destFolderId={null}
          onNavigate={() => onNavigate(currentScope.id, null)}
          dragging={dragging}
          first={os}
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
      {shown.map((c) => (
        <Crumb
          key={c.id}
          label={c.title}
          testid={`drive-crumb-${c.id}`}
          scopeId={currentScope!.id}
          destFolderId={c.id}
          onNavigate={() => onNavigate(currentScope!.id, c.id)}
          dragging={dragging}
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
}: {
  label: string;
  testid: string;
  scopeId: string;
  destFolderId: string | null;
  onNavigate: () => void;
  dragging: boolean;
  /** Leads the trail (no root crumb before it), so it takes no separator. */
  first?: boolean;
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
        className={`inline-flex items-center rounded px-1.5 py-0.5 font-medium truncate max-w-[12rem] ${
          drop.isOver ? "bg-accent-coral/10 text-accent-coral ring-1 ring-accent-coral/40" : "text-foreground hover:bg-muted/50"
        }`}
      >
        {label}
      </button>
    </>
  );
}

// ── Root: the list of drives (list/grid view only) ───────────────────────────

function ScopeList({
  scopes,
  selected,
  onRowClick,
  onOpen,
}: {
  scopes: DriveTreeScope[];
  selected: Set<string>;
  onRowClick: (id: string, e: ReactMouseEvent) => void;
  onOpen: (id: string) => void;
}) {
  const t = useDriveText();
  if (scopes.length === 0) return <EmptyLine>Your Drive is empty.</EmptyLine>;
  return (
    <div className="flex flex-col divide-y divide-border/50 p-1">
      {scopes.map((scope) => {
        const isCore = scope.id === "core";
        const isHiring = scope.id === "hiring";
        const isGroupScope = scope.id === "projects" || scope.id === "education";
        const isProject = scope.id !== "mine" && scope.id !== "lab" && !isCore && !isHiring && !isGroupScope;
        const label = scope.id === "mine" ? "My Drive" : scope.id === "lab" ? "Lab" : scope.label;
        return (
          <div
            key={scope.id}
            data-testid={`drive-scope-${scope.id}`}
            onClick={(e) => onRowClick(scope.id, e)}
            onDoubleClick={() => onOpen(scope.id)}
            className={`group flex items-center gap-3 px-3 py-2.5 ${t.row} cursor-default select-none rounded-md ${
              selected.has(scope.id) ? "bg-accent-coral/10" : "hover:bg-muted/50"
            }`}
          >
            {scopeIcon(scope)}
            <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{label}</span>
            {/* Signal ③: scope audience chip — hover-reveal via group-hover. */}
            {scope.scopeAudience ? (
              <span
                className={`shrink-0 ${t.badge} tracking-wide text-muted-foreground opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity`}
              >
                {scope.scopeAudience}
              </span>
            ) : null}
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
        );
      })}
    </div>
  );
}

// ── In-scope contents (list + grid) ──────────────────────────────────────────

function ScopeContents({
  scope,
  listing,
  viewMode,
  sort,
  onToggleSort,
  selected,
  activeId,
  onRowClick,
  onOpen,
  onMove,
  actions,
  onToggleFavorite,
  onTogglePartnerVisible,
  dragging,
  suppressClickRef,
}: {
  scope: DriveTreeScope;
  listing: DriveItem[];
  viewMode: "list" | "grid";
  sort: { key: SortKey; dir: SortDir };
  onToggleSort: (key: SortKey) => void;
  selected: Set<string>;
  activeId: string | null;
  onRowClick: (id: string, e: ReactMouseEvent) => void;
  onOpen: (id: string) => void;
  onMove: (scopeId: string, item: DriveItem, destFolderId: string | null) => void;
  actions: RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
  dragging: boolean;
  suppressClickRef: React.MutableRefObject<boolean>;
}) {
  const t = useDriveText();
  if (listing.length === 0) return <EmptyLine>This folder is empty. Drop files here to upload.</EmptyLine>;

  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-3" data-testid="drive-listing">
        {listing.map((item) => (
          <GridTile
            key={item.id}
            item={item}
            scopeId={scope.id}
            selected={selected.has(item.id)}
            active={activeId === item.id}
            onRowClick={onRowClick}
            onOpen={onOpen}
            actions={actions}
            onToggleFavorite={onToggleFavorite}
            onTogglePartnerVisible={onTogglePartnerVisible}
            suppressClickRef={suppressClickRef}
          />
        ))}
      </div>
    );
  }

  return (
    <div data-testid="drive-listing">
      {/* Column header (sortable) */}
      <div
        className={`grid items-center gap-2 border-b border-border px-3 py-1.5 ${t.label} font-medium uppercase tracking-wide text-muted-foreground`}
        style={{ gridTemplateColumns: GRID_COLUMNS }}
      >
        <SortHeader label="Name" active={sort.key === "name"} dir={sort.dir} onClick={() => onToggleSort("name")} testid="drive-sort-name" />
        <SortHeader label="Modified" active={sort.key === "modified"} dir={sort.dir} onClick={() => onToggleSort("modified")} testid="drive-sort-modified" />
        <SortHeader label="Size" active={sort.key === "size"} dir={sort.dir} onClick={() => onToggleSort("size")} align="right" testid="drive-sort-size" />
        <span aria-hidden="true" />
      </div>
      <div className="flex flex-col divide-y divide-border/50">
        {listing.map((item) => (
          <ListRow
            key={item.id}
            item={item}
            scopeId={scope.id}
            selected={selected.has(item.id)}
            active={activeId === item.id}
            onRowClick={onRowClick}
            onOpen={onOpen}
            actions={actions}
            onToggleFavorite={onToggleFavorite}
            onTogglePartnerVisible={onTogglePartnerVisible}
            suppressClickRef={suppressClickRef}
          />
        ))}
      </div>
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
  active,
  onRowClick,
  onOpen,
  actions,
  onToggleFavorite,
  onTogglePartnerVisible,
  suppressClickRef,
}: {
  item: DriveItem;
  scopeId: string;
  selected: boolean;
  active: boolean;
  onRowClick: (id: string, e: ReactMouseEvent) => void;
  onOpen: (id: string) => void;
  actions: RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
  suppressClickRef: React.MutableRefObject<boolean>;
}) {
  const t = useDriveText();
  const isFolder = item.type === "folder";
  const isManaged = item.type === "agreement" || item.type === "rubric" || item.type === "emailTemplate";
  // Signal ①: system-managed folders are also non-draggable.
  const isSystemManaged =
    isFolder && !!(item as { systemKey?: string | null }).systemKey;
  const drag = useDraggable({
    id: `${scopeId}::${item.id}`,
    data: { item, scopeId },
    disabled: isManaged || isSystemManaged,
  });
  const drop = useDroppable({
    id: `${scopeId}::drop::${item.id}`,
    data: { destFolderId: item.id, destScopeId: scopeId },
    disabled: !isFolder,
  });
  function setRefs(node: HTMLDivElement | null) {
    drag.setNodeRef(node);
    if (isFolder) drop.setNodeRef(node);
  }

  const row = (
    <div
      ref={setRefs}
      {...drag.attributes}
      {...drag.listeners}
      data-testid={`drive-item-${item.type}-${item.id}`}
      onClick={(e) => onRowClick(item.id, e)}
      onDoubleClick={() => onOpen(item.id)}
      style={{
        gridTemplateColumns: GRID_COLUMNS,
        ...(drag.transform ? { transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)`, transition: "none" } : {}),
      }}
      className={`group grid items-center gap-2 px-3 py-2 ${t.row} cursor-default select-none ${
        drag.isDragging ? "opacity-40" : ""
      } ${
        drop.isOver && isFolder
          ? "bg-accent-coral/10 ring-1 ring-accent-coral/40"
          : selected
            ? "bg-accent-coral/10"
            : active
              ? "bg-muted/40"
              : "hover:bg-muted/50"
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        {itemIcon(item)}
        <span className="truncate font-medium text-foreground">{item.title || "Untitled"}</span>
        {/* Signal ②: process linkage pill. */}
        {item.linkedProcess && (
          <ProcessLinkPill label={item.linkedProcess.label} href={item.linkedProcess.href} />
        )}
        {/* Signal ①: "Managed" chip revealed on hover for system-keyed folders. */}
        {isSystemManaged && (
          <Tooltip
            content="This folder is managed by the system. Rename and delete are unavailable to keep internal processes consistent."
            variant="rich"
          >
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              Managed
            </span>
          </Tooltip>
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
      <span className={`${t.meta} text-muted-foreground tabular-nums truncate`}>{relativeTime(item.updatedAt as unknown as string)}</span>
      <span className={`${t.meta} text-muted-foreground tabular-nums text-right`}>{formatSize(item.sizeBytes)}</span>
      <span className="flex items-center justify-end">
        <FavoriteButton item={item} onToggleFavorite={onToggleFavorite} />
        <RowActionsMenu
          item={item}
          actions={actions}
          onOpen={() => onOpen(item.id)}
          onToggleFavorite={onToggleFavorite}
          onTogglePartnerVisible={onTogglePartnerVisible}
        />
      </span>
    </div>
  );

  return (
    <ContextMenu
      items={itemMenuItems(item, actions, () => onOpen(item.id), onToggleFavorite, onTogglePartnerVisible)}
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
  active,
  onRowClick,
  onOpen,
  actions,
  onToggleFavorite,
  onTogglePartnerVisible,
  suppressClickRef,
}: {
  item: DriveItem;
  scopeId: string;
  selected: boolean;
  active: boolean;
  onRowClick: (id: string, e: ReactMouseEvent) => void;
  onOpen: (id: string) => void;
  actions: RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
  suppressClickRef: React.MutableRefObject<boolean>;
}) {
  const t = useDriveText();
  const isFolder = item.type === "folder";
  const isManaged = item.type === "agreement" || item.type === "rubric" || item.type === "emailTemplate";
  // Signal ①: system-managed folders are also non-draggable.
  const isSystemManaged =
    isFolder && !!(item as { systemKey?: string | null }).systemKey;
  const drag = useDraggable({
    id: `${scopeId}::${item.id}`,
    data: { item, scopeId },
    disabled: isManaged || isSystemManaged,
  });
  const drop = useDroppable({
    id: `${scopeId}::drop::${item.id}`,
    data: { destFolderId: item.id, destScopeId: scopeId },
    disabled: !isFolder,
  });
  function setRefs(node: HTMLDivElement | null) {
    drag.setNodeRef(node);
    if (isFolder) drop.setNodeRef(node);
  }

  const tile = (
    <div
      ref={setRefs}
      {...drag.attributes}
      {...drag.listeners}
      data-testid={`drive-item-${item.type}-${item.id}`}
      onClick={(e) => onRowClick(item.id, e)}
      onDoubleClick={() => onOpen(item.id)}
      style={drag.transform ? { transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)`, transition: "none" } : undefined}
      className={`group relative flex flex-col items-center gap-2 rounded-lg border p-3 text-center cursor-default select-none ${
        drag.isDragging ? "opacity-40" : ""
      } ${
        drop.isOver && isFolder
          ? "border-accent-coral/40 bg-accent-coral/10"
          : selected
            ? "border-accent-coral/40 bg-accent-coral/10"
            : active
              ? "border-border bg-muted/40"
              : "border-border hover:bg-muted/40"
      }`}
    >
      <div className="absolute right-1 top-1 flex items-center">
        <FavoriteButton item={item} onToggleFavorite={onToggleFavorite} />
        <RowActionsMenu
          item={item}
          actions={actions}
          onOpen={() => onOpen(item.id)}
          onToggleFavorite={onToggleFavorite}
          onTogglePartnerVisible={onTogglePartnerVisible}
        />
      </div>
      {/* Partner-visible badge: positioned top-left so it doesn't conflict
          with the actions/star buttons on the right. */}
      {(item.type === "doc" || item.type === "file") &&
        (item as { partnerVisible?: boolean | null }).partnerVisible && (
          <Tooltip content="Shared with partner">
            <span className="absolute left-1 top-1 flex items-center text-accent-teal">
              <Handshake className="w-3 h-3" />
            </span>
          </Tooltip>
        )}
      {itemIcon(item, true)}
      <span className={`w-full truncate ${t.meta} font-medium text-foreground`}>{item.title || "Untitled"}</span>
      {/* Signal ②: process linkage pill. Centered below the title. */}
      {item.linkedProcess && (
        <ProcessLinkPill label={item.linkedProcess.label} href={item.linkedProcess.href} />
      )}
      {/* Signal ①: "Managed" chip on hover for system-keyed folders. */}
      {isSystemManaged && (
        <Tooltip
          content="This folder is managed by the system. Rename and delete are unavailable to keep internal processes consistent."
          variant="rich"
        >
          <span
            className={`shrink-0 rounded-sm bg-muted px-1.5 py-0.5 ${t.badge} font-medium leading-none text-muted-foreground opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity`}
          >
            Managed
          </span>
        </Tooltip>
      )}
    </div>
  );

  return (
    <ContextMenu
      items={itemMenuItems(item, actions, () => onOpen(item.id), onToggleFavorite, onTogglePartnerVisible)}
      ariaLabel="Item actions"
    >
      {tile}
    </ContextMenu>
  );
}

// ── Search results ───────────────────────────────────────────────────────────

function SearchResults({
  hits,
  selected,
  onRowClick,
  onOpen,
  getScopeActions,
  onToggleFavorite,
}: {
  hits: SearchHit[];
  selected: Set<string>;
  onRowClick: (id: string, e: ReactMouseEvent) => void;
  onOpen: (id: string) => void;
  getScopeActions: (scopeId: string) => RowActions;
  onToggleFavorite?: (item: DriveItem) => void;
}) {
  const t = useDriveText();
  if (hits.length === 0) return <EmptyLine>No matches.</EmptyLine>;
  return (
    <div className="flex flex-col divide-y divide-border/50 p-1" data-testid="drive-search-results">
      {hits.map((hit) => (
        <div
          key={`${hit.scope.id}:${hit.item.id}`}
          data-testid={`drive-search-hit-${hit.item.id}`}
          onClick={(e) => onRowClick(hit.item.id, e)}
          onDoubleClick={() => onOpen(hit.item.id)}
          className={`group flex items-center gap-3 px-3 py-2 ${t.row} cursor-default select-none rounded-md ${
            selected.has(hit.item.id) ? "bg-accent-coral/10" : "hover:bg-muted/50"
          }`}
        >
          {itemIcon(hit.item)}
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-foreground">{hit.item.title || "Untitled"}</span>
            <span className={`ml-2 ${t.meta} text-muted-foreground truncate`}>{hit.path}</span>
          </span>
          {/* Signal ②: process linkage pill in search results. */}
          {hit.item.linkedProcess && (
            <ProcessLinkPill label={hit.item.linkedProcess.label} href={hit.item.linkedProcess.href} />
          )}
          <RowActionsMenu
            item={hit.item}
            actions={getScopeActions(hit.scope.id)}
            onOpen={() => onOpen(hit.item.id)}
            onToggleFavorite={onToggleFavorite}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  const t = useDriveText();
  return <p className={`px-3 py-8 text-center ${t.row} text-muted-foreground italic`}>{children}</p>;
}
