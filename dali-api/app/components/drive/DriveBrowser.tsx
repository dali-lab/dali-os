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
//     context menu, keyboard navigation, details pane, breadcrumb, sort.

import {
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
  PanelRight,
  Upload,
  FolderOpen,
  Download,
  Share2,
  Columns,
  ClipboardCheck,
} from "lucide-react";
import type { DriveItem } from "~/lib/drive.server";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import { PageIcon } from "~/components/PageIcon";
import { Menu, ContextMenu } from "~/components/ui/floating";
import { relativeTime } from "~/lib/relative-time";

export type RowActions = {
  onRename: (item: DriveItem) => void;
  onRequestMove: (item: DriveItem) => void;
  onDelete: (item: DriveItem) => void;
};

type SortKey = "name" | "modified" | "size";
type SortDir = "asc" | "desc";
type ViewMode = "columns" | "list" | "grid";

export type DriveBrowserProps = {
  scopes: DriveTreeScope[];
  currentScopeId: string | null;
  currentFolderId: string | null;
  typeFilter: "all" | "doc" | "file" | "form" | "agreement";
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
  /** Upload files dropped from the desktop into the current scope+folder. */
  onUploadFiles?: (files: File[]) => void;
  filterControl?: ReactNode;
  newMenu?: ReactNode;
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
): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  for (const scope of scopes) {
    for (const item of scope.items) {
      if (typeFilter !== "all" && item.type !== typeFilter) continue;
      if (!(item.title || "").toLowerCase().includes(needle)) continue;
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
      return <Folder className={`${cls} text-accent-coral/80 shrink-0`} />;
    case "file":
      return <Paperclip className={`${cls} text-muted-foreground shrink-0`} />;
    case "form":
      return <ClipboardList className={`${cls} text-muted-foreground shrink-0`} />;
    case "agreement":
      return <FileSignature className={`${cls} text-muted-foreground shrink-0`} />;
    case "rubric":
      return <ClipboardCheck className={`${cls} text-muted-foreground shrink-0`} />;
    default:
      return <PageIcon iconEmoji={item.iconEmoji} />;
  }
}

function scopeIcon(scope: DriveTreeScope) {
  if (scope.id === "mine") return <User className="w-4 h-4 text-muted-foreground shrink-0" />;
  if (scope.id === "core") return <Shield className="w-4 h-4 text-accent-coral/80 shrink-0" />;
  if (scope.id === "hiring") return <Briefcase className="w-4 h-4 text-accent-coral/80 shrink-0" />;
  if (scope.id === "lab") return <Users className="w-4 h-4 text-muted-foreground shrink-0" />;
  if (scope.iconEmoji) return <span className="text-base leading-none shrink-0">{scope.iconEmoji}</span>;
  return <Folder className="w-4 h-4 text-accent-coral/80 shrink-0" />;
}

// Menu.Item nodes shared by the row "⋯" dropdown and the right-click menu.
function itemMenuItems(
  item: DriveItem,
  actions: RowActions,
  onOpen: () => void,
  onToggleFavorite?: (item: DriveItem) => void,
): ReactNode {
  const canRename = item.type === "folder" || item.type === "doc" || item.type === "file";
  const canMove = item.type !== "agreement";
  const canDelete = item.type === "folder" || item.type === "doc" || item.type === "file";
  const canFavorite = item.type === "doc" || item.type === "folder";
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
}: {
  item: DriveItem;
  actions: RowActions;
  onOpen: () => void;
  onToggleFavorite?: (item: DriveItem) => void;
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
      {itemMenuItems(item, actions, onOpen, onToggleFavorite)}
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
  onUploadFiles,
  filterControl,
  newMenu,
}: DriveBrowserProps) {
  const currentScope = useMemo(
    () => scopes.find((s) => s.id === currentScopeId) ?? null,
    [scopes, currentScopeId],
  );

  // ── Legacy list/grid state (for non-column views) ──────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  const [viewMode, setViewMode] = useState<ViewMode>("columns");
  const [detailsOpen, setDetailsOpen] = useState(false);
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const suppressClickRef = useRef(false);

  const searching = search.trim().length > 0;
  const hits = useMemo(
    () => (searching ? searchAll(scopes, search, typeFilter) : []),
    [searching, scopes, search, typeFilter],
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

  const selectedItems = useMemo(
    () => listing.filter((i) => selected.has(i.id)),
    [listing, selected],
  );

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
    } else if (e.key === "F2" && currentScope && activeId) {
      const item = listing.find((i) => i.id === activeId);
      if (item) getScopeActions(currentScope.id).onRename(item);
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
    const dest = e.over?.data.current as { destFolderId: string | null } | undefined;
    if (!src || !dest || !currentScope) return;
    if (src.item.type === "folder" && dest.destFolderId !== null) {
      if (folderDescendants(currentScope.items, src.item.id).has(dest.destFolderId)) return;
    }
    if (src.item.parentFolderId === dest.destFolderId) return;
    onMove(currentScope.id, src.item, dest.destFolderId);
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

  const showBulk = !searching && !!currentScope && selected.size > 1;

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
  function handleColumnRowClick(levelIdx: number, item: DriveItem, scopeId: string) {
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

  // Double-click a leaf → open it.
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
  const leafActions = leafScopeId ? getScopeActions(leafScopeId) : null;

  const canLeafRename =
    selectedLeaf &&
    (selectedLeaf.type === "folder" || selectedLeaf.type === "doc" || selectedLeaf.type === "file");
  const canLeafMove = selectedLeaf && selectedLeaf.type !== "agreement";
  const canLeafDelete =
    selectedLeaf &&
    (selectedLeaf.type === "folder" || selectedLeaf.type === "doc" || selectedLeaf.type === "file");
  // Download: only for files with an href.
  const canLeafDownload = selectedLeaf && selectedLeaf.type === "file";

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-3" data-testid="drive-browser" onClick={() => setSelected(new Set())}>
        {/* ── Toolbar row: breadcrumb · filter · search · view · details · New ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <Breadcrumb
            currentScope={currentScope}
            folderCrumbs={folderCrumbs}
            onNavigate={onNavigate}
            dragging={!!activeDrag}
          />

          {filterControl}

          <div className="relative w-full sm:w-56 shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="search"
              value={search}
              data-testid="drive-search"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search Drive"
              className="w-full rounded-md border border-border bg-card pl-8 pr-8 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent-coral/40"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={(e) => {
                  e.stopPropagation();
                  onSearchChange("");
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* View toggle — columns / list / grid */}
          <div className="inline-flex rounded-md border border-border overflow-hidden shrink-0">
            <button
              type="button"
              data-testid="drive-view-columns"
              aria-label="Column view"
              aria-pressed={viewMode === "columns"}
              onClick={(e) => {
                e.stopPropagation();
                changeView("columns");
              }}
              className={`p-1.5 ${viewMode === "columns" ? "bg-accent-coral/10 text-accent-coral" : "text-muted-foreground hover:bg-muted/50"}`}
            >
              <Columns className="w-4 h-4" />
            </button>
            <button
              type="button"
              data-testid="drive-view-list"
              aria-label="List view"
              aria-pressed={viewMode === "list"}
              onClick={(e) => {
                e.stopPropagation();
                changeView("list");
              }}
              className={`p-1.5 ${viewMode === "list" ? "bg-accent-coral/10 text-accent-coral" : "text-muted-foreground hover:bg-muted/50"}`}
            >
              <ListIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              data-testid="drive-view-grid"
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
              onClick={(e) => {
                e.stopPropagation();
                changeView("grid");
              }}
              className={`p-1.5 ${viewMode === "grid" ? "bg-accent-coral/10 text-accent-coral" : "text-muted-foreground hover:bg-muted/50"}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            data-testid="drive-details-toggle"
            aria-label="Toggle details"
            aria-pressed={detailsOpen}
            onClick={(e) => {
              e.stopPropagation();
              setDetailsOpen((v) => !v);
            }}
            className={`shrink-0 rounded-md border border-border p-1.5 ${detailsOpen ? "bg-accent-coral/10 text-accent-coral" : "text-muted-foreground hover:bg-muted/50"}`}
          >
            <PanelRight className="w-4 h-4" />
          </button>

          {newMenu}
        </div>

        {/* ── Bulk action bar (multi-select, list/grid only) ── */}
        {showBulk && viewMode !== "columns" && (
          <div
            className="flex items-center gap-3 rounded-md border border-accent-coral/40 bg-accent-coral/5 px-3 py-1.5 text-sm"
            data-testid="drive-bulk-bar"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="font-medium text-foreground">{selected.size} selected</span>
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
            className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm"
            data-testid="drive-leaf-toolbar"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="flex items-center gap-1.5 min-w-0 flex-1">
              {itemIcon(selectedLeaf)}
              <span className="font-medium text-foreground truncate">{selectedLeaf.title || "Untitled"}</span>
              <span className="text-xs text-muted-foreground shrink-0">{kindLabel(selectedLeaf)}</span>
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {canLeafDownload && selectedLeaf.href && (
                <a
                  href={selectedLeaf.href}
                  download
                  data-testid="drive-leaf-download"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <FolderInput className="w-3.5 h-3.5" /> Move
                </button>
              )}
              {/* Share: navigate to the item so the user can use the share UI there */}
              {selectedLeaf.href && (
                <a
                  href={selectedLeaf.href}
                  data-testid="drive-leaf-share"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <Share2 className="w-3.5 h-3.5" /> Share
                </a>
              )}
              {canLeafDelete && (
                <button
                  type="button"
                  data-testid="drive-leaf-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    leafActions.onDelete(selectedLeaf);
                  }}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Body ── */}
        <div className={detailsOpen ? "flex gap-3 items-start" : ""}>
          {viewMode === "columns" && !searching ? (
            /* ── MILLER COLUMNS ─────────────────────────────────────────── */
            <div
              ref={columnsContainerRef}
              className="flex-1 min-w-0 rounded-lg border border-border bg-card overflow-x-auto"
              style={{ height: "calc(100vh - 14rem)" }}
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
              <div className="flex h-full divide-x divide-border/60">
                {/* Column 0: scope list */}
                <MillerColumn
                  testid="drive-col-root"
                  isEmpty={scopes.length === 0}
                  emptyMessage="No drives available."
                >
                  {scopes.map((scope) => {
                    const isCore = scope.id === "core";
                    const isHiring = scope.id === "hiring";
                    const isProject =
                      scope.id !== "mine" && scope.id !== "lab" && !isCore && !isHiring;
                    const label =
                      scope.id === "mine"
                        ? "My Drive"
                        : scope.id === "lab"
                          ? "Lab"
                          : scope.label;
                    const isHighlighted = colSel.highlightedIds[0] === scope.id;
                    return (
                      <div
                        key={scope.id}
                        data-testid={`drive-scope-${scope.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleScopeClick(scope.id);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleScopeDblClick(scope.id);
                        }}
                        className={`group flex items-center gap-2 px-3 py-2 text-sm cursor-default select-none ${
                          isHighlighted
                            ? "bg-accent-coral/10 text-accent-coral"
                            : "hover:bg-muted/50 text-foreground"
                        }`}
                      >
                        {scopeIcon(scope)}
                        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                        {isCore && (
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-accent-coral/70">
                            Core only
                          </span>
                        )}
                        {isHiring && (
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-accent-coral/70">
                            Hiring team
                          </span>
                        )}
                        {isProject && (
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-accent-coral/70">
                            Project
                          </span>
                        )}
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 opacity-60" />
                      </div>
                    );
                  })}
                </MillerColumn>

                {/* Columns 1+: scope/folder contents */}
                {colSel.levels.slice(1).map((level, relIdx) => {
                  const levelIdx = relIdx + 1;
                  const sId = scopeIdForLevel(level);
                  const items = itemsForLevel(level);
                  const highlightedId = colSel.highlightedIds[levelIdx] ?? null;

                  return (
                    <MillerColumn
                      key={`col-${levelIdx}`}
                      testid={`drive-col-${levelIdx}`}
                      isEmpty={items.length === 0}
                      emptyMessage="This folder is empty."
                    >
                      {items.map((item) => {
                        const isFolder = item.type === "folder";
                        const isHighlighted = highlightedId === item.id;
                        const scopeActions = sId ? getScopeActions(sId) : null;
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
                                  )
                                : null
                            }
                            ariaLabel="Item actions"
                          >
                            <div
                              data-testid={`drive-item-${item.type}-${item.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (sId) handleColumnRowClick(levelIdx, item, sId);
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                handleColumnRowDblClick(item);
                              }}
                              className={`group flex items-center gap-2 px-3 py-2 text-sm cursor-default select-none ${
                                isHighlighted
                                  ? "bg-accent-coral/10 text-accent-coral"
                                  : "hover:bg-muted/50 text-foreground"
                              }`}
                            >
                              {itemIcon(item)}
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {item.title || "Untitled"}
                              </span>
                              {/* Inline star for favorites */}
                              {(item.type === "doc" || item.type === "folder") &&
                                onToggleFavorite && (
                                  <button
                                    type="button"
                                    aria-label={item.favorited ? "Remove from favorites" : "Add to favorites"}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onToggleFavorite(item);
                                    }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onDoubleClick={(e) => e.stopPropagation()}
                                    className={`shrink-0 rounded p-0.5 transition-opacity ${
                                      item.favorited
                                        ? "text-accent-coral opacity-100"
                                        : "text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                                    }`}
                                  >
                                    <Star
                                      className={`h-3.5 w-3.5 ${item.favorited ? "fill-current" : ""}`}
                                    />
                                  </button>
                                )}
                              {/* Actions menu */}
                              {scopeActions && (
                                <RowActionsMenu
                                  item={item}
                                  actions={scopeActions}
                                  onOpen={() => onOpenItem(item)}
                                  onToggleFavorite={onToggleFavorite}
                                />
                              )}
                              {isFolder && (
                                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 opacity-60" />
                              )}
                            </div>
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
                  getScopeActions={getScopeActions}
                  onToggleFavorite={onToggleFavorite}
                />
              ) : !currentScope ? (
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
                  actions={getScopeActions(currentScope.id)}
                  onToggleFavorite={onToggleFavorite}
                  dragging={!!activeDrag}
                  suppressClickRef={suppressClickRef}
                />
              )}
            </div>
          )}

          {detailsOpen && (
            <DetailsPane
              currentScope={currentScope}
              currentFolderId={currentFolderId}
              listing={listing}
              selectedItems={selectedItems}
              onOpen={onOpenItem}
            />
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm shadow-lg">
            {itemIcon(activeDrag)}
            <span className="font-medium text-foreground">{activeDrag.title || "Untitled"}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
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
  return (
    <div
      data-testid={testid}
      // flex-1 so the open columns expand to fill the width (and share it as
      // more open); min-width keeps each readable and lets the row scroll
      // horizontally once it's deep enough to overflow.
      className="flex flex-1 flex-col overflow-y-auto min-w-[14rem]"
    >
      {isEmpty ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground italic">{emptyMessage}</p>
      ) : (
        <div className="flex flex-col py-1">{children}</div>
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
  const collapse = folderCrumbs.length > 3;
  const hidden = collapse ? folderCrumbs.slice(0, folderCrumbs.length - 2) : [];
  const shown = collapse ? folderCrumbs.slice(folderCrumbs.length - 2) : folderCrumbs;

  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="drive-breadcrumb"
      className="flex items-center gap-1 min-w-0 flex-1 text-sm"
    >
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
      {currentScope && (
        <Crumb
          label={currentScope.id === "mine" ? "My Drive" : currentScope.id === "lab" ? "Lab" : currentScope.label}
          testid="drive-crumb-scope"
          scopeId={currentScope.id}
          destFolderId={null}
          onNavigate={() => onNavigate(currentScope.id, null)}
          dragging={dragging}
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
}: {
  label: string;
  testid: string;
  scopeId: string;
  destFolderId: string | null;
  onNavigate: () => void;
  dragging: boolean;
}) {
  const drop = useDroppable({
    id: `crumb::${scopeId}::${destFolderId ?? "_root_"}`,
    data: { destFolderId, destScopeId: scopeId },
    disabled: !dragging,
  });
  return (
    <>
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
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
  if (scopes.length === 0) return <EmptyLine>Your Drive is empty.</EmptyLine>;
  return (
    <div className="flex flex-col divide-y divide-border/50 p-1">
      {scopes.map((scope) => {
        const isCore = scope.id === "core";
        const isHiring = scope.id === "hiring";
        const isProject = scope.id !== "mine" && scope.id !== "lab" && !isCore && !isHiring;
        const label = scope.id === "mine" ? "My Drive" : scope.id === "lab" ? "Lab" : scope.label;
        return (
          <div
            key={scope.id}
            data-testid={`drive-scope-${scope.id}`}
            onClick={(e) => onRowClick(scope.id, e)}
            onDoubleClick={() => onOpen(scope.id)}
            className={`group flex items-center gap-3 px-3 py-2.5 text-sm cursor-default select-none rounded-md ${
              selected.has(scope.id) ? "bg-accent-coral/10" : "hover:bg-muted/50"
            }`}
          >
            {scopeIcon(scope)}
            <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{label}</span>
            {isCore && <span className="shrink-0 text-[10px] uppercase tracking-wide text-accent-coral/70">Core only</span>}
            {isHiring && <span className="shrink-0 text-[10px] uppercase tracking-wide text-accent-coral/70">Hiring team</span>}
            {isProject && <span className="shrink-0 text-[10px] uppercase tracking-wide text-accent-coral/70">Project</span>}
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
  dragging: boolean;
  suppressClickRef: React.MutableRefObject<boolean>;
}) {
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
        className="grid items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
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
  suppressClickRef: React.MutableRefObject<boolean>;
}) {
  const isFolder = item.type === "folder";
  const drag = useDraggable({ id: `${scopeId}::${item.id}`, data: { item, scopeId } });
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
      className={`group grid items-center gap-2 px-3 py-2 text-sm cursor-default select-none ${
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
      </span>
      <span className="text-xs text-muted-foreground tabular-nums truncate">{relativeTime(item.updatedAt as unknown as string)}</span>
      <span className="text-xs text-muted-foreground tabular-nums text-right">{formatSize(item.sizeBytes)}</span>
      <span className="flex items-center justify-end">
        <FavoriteButton item={item} onToggleFavorite={onToggleFavorite} />
        <RowActionsMenu item={item} actions={actions} onOpen={() => onOpen(item.id)} onToggleFavorite={onToggleFavorite} />
      </span>
    </div>
  );

  return (
    <ContextMenu items={itemMenuItems(item, actions, () => onOpen(item.id), onToggleFavorite)} ariaLabel="Item actions">
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
  suppressClickRef: React.MutableRefObject<boolean>;
}) {
  const isFolder = item.type === "folder";
  const drag = useDraggable({ id: `${scopeId}::${item.id}`, data: { item, scopeId } });
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
        <RowActionsMenu item={item} actions={actions} onOpen={() => onOpen(item.id)} onToggleFavorite={onToggleFavorite} />
      </div>
      {itemIcon(item, true)}
      <span className="w-full truncate text-xs font-medium text-foreground">{item.title || "Untitled"}</span>
    </div>
  );

  return (
    <ContextMenu items={itemMenuItems(item, actions, () => onOpen(item.id), onToggleFavorite)} ariaLabel="Item actions">
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
  if (hits.length === 0) return <EmptyLine>No matches.</EmptyLine>;
  return (
    <div className="flex flex-col divide-y divide-border/50 p-1" data-testid="drive-search-results">
      {hits.map((hit) => (
        <div
          key={`${hit.scope.id}:${hit.item.id}`}
          data-testid={`drive-search-hit-${hit.item.id}`}
          onClick={(e) => onRowClick(hit.item.id, e)}
          onDoubleClick={() => onOpen(hit.item.id)}
          className={`group flex items-center gap-3 px-3 py-2 text-sm cursor-default select-none rounded-md ${
            selected.has(hit.item.id) ? "bg-accent-coral/10" : "hover:bg-muted/50"
          }`}
        >
          {itemIcon(hit.item)}
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-foreground">{hit.item.title || "Untitled"}</span>
            <span className="ml-2 text-xs text-muted-foreground truncate">{hit.path}</span>
          </span>
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

// ── Details pane ─────────────────────────────────────────────────────────────

function DetailsPane({
  currentScope,
  currentFolderId,
  listing,
  selectedItems,
  onOpen,
}: {
  currentScope: DriveTreeScope | null;
  currentFolderId: string | null;
  listing: DriveItem[];
  selectedItems: DriveItem[];
  onOpen: (item: DriveItem) => void;
}) {
  const one = selectedItems.length === 1 ? selectedItems[0] : null;
  const path = currentScope
    ? [currentScope.id === "mine" ? "My Drive" : currentScope.id === "lab" ? "Lab" : currentScope.label, ...crumbsFor(currentScope.items, currentFolderId).map((c) => c.title)].join(" › ")
    : "Drive";

  return (
    <aside
      className="w-64 shrink-0 rounded-lg border border-border bg-card p-4 text-sm"
      data-testid="drive-details"
      onClick={(e) => e.stopPropagation()}
    >
      {selectedItems.length > 1 ? (
        <p className="font-medium text-foreground">{selectedItems.length} items selected</p>
      ) : one ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col items-center gap-2 py-2">
            {itemIcon(one, true)}
            <p className="text-center font-semibold text-foreground break-words">{one.title || "Untitled"}</p>
          </div>
          <dl className="flex flex-col gap-1.5 text-xs">
            <Row label="Kind" value={kindLabel(one)} />
            <Row label="Modified" value={relativeTime(one.updatedAt as unknown as string)} />
            {one.type === "file" && <Row label="Size" value={formatSize(one.sizeBytes) || "—"} />}
            <Row label="Location" value={path} />
          </dl>
          <button
            type="button"
            onClick={() => onOpen(one)}
            className="mt-1 inline-flex items-center justify-center gap-1 rounded-md bg-accent-coral px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-coral/90"
          >
            <FolderOpen className="w-3.5 h-3.5" /> Open
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 text-xs">
          <p className="font-medium text-foreground text-sm">{path}</p>
          <p className="text-muted-foreground">{listing.length} item{listing.length === 1 ? "" : "s"}</p>
          <p className="text-muted-foreground mt-2">Select an item to see its details.</p>
        </div>
      )}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-foreground text-right break-words min-w-0">{value}</dd>
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-3 py-8 text-center text-sm text-muted-foreground italic">{children}</p>;
}
