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

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { DndContext, DragOverlay, pointerWithin } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Search, X, List as ListIcon, LayoutGrid, Upload, Columns } from "lucide-react";
import type { DriveItem } from "~/drive/lib/drive.server";
import { listedUnderFilter, type DriveTypeFilter } from "~/components/drive/type-filter";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { ContextMenu, Tooltip, isInFloatingLayer } from "~/components/ui/floating";
import { useSidePanel } from "~/components/side-panel/use-side-panel";
import { ShareDialog, type ShareTarget } from "~/components/sharing/ShareDialog";
import { useRevalidator } from "react-router";
import { useToast } from "~/components/ui/toast";
import { notebookRequest, sendJson } from "~/components/notebooks/notebook-requests";
import { cn } from "~/lib/cn";
import { FAVORITES_SPACE_KEY, isProcessRootSpace, SHARED_SPACE_KEY } from "~/drive/lib/drive-spaces";
import { LoadMore } from "~/components/ui/Pager";
import { useClientSlice } from "~/hooks/useClientSlice";
import { crumbsFor } from "~/components/drive/location";
import { downloadItems } from "~/components/drive/download-files";
import { clickIntent } from "~/components/drive/column-click";
import { MarqueeBox, useMarquee } from "~/components/drive/use-marquee";
import { useDriveSelection } from "~/components/drive/use-drive-selection";
import { useDriveKeyboard } from "~/components/drive/use-drive-keyboard";
import { useDriveDnd } from "~/components/drive/use-drive-dnd";
import { FolderSettingsModal } from "~/components/drive/FolderSettingsModal";
import { EmptyState } from "~/components/ui/EmptyState";
import { meetingsOptionFor } from "~/components/drive/receiver-options";
import { Breadcrumb } from "./Breadcrumb";
import { columnLevels, openRowIdAt, ColumnScopeRow, ColumnItemRow, MillerColumn, type ColumnLevel } from "./ColumnView";
import { DriveBulkBar } from "./DriveBulkBar";
import { DriveQuickPreview } from "./DriveQuickPreview";
import { itemMenuItems } from "./RowActionsMenu";
import { ScopeContents } from "./ScopeContents";
import { ScopeList } from "./ScopeList";
import { SearchResults } from "./SearchResults";
import { BesideContext, besideTarget, type BesideState } from "./beside";
import { childrenAt, sortItems, searchAll, type SortKey, type SortDir, type ViewMode, type DriveLocation } from "./browser-items";
import { focusPane, isPlainDocument, FileDropContext, DROP_OVERLAY, type FileDropOptions } from "./drop-zone";
import { itemIcon } from "./item-icons";
import type { RowHandlers, RowActions } from "./row-types";
export type { RowHandlers, RowActions } from "./row-types";
export type { FileDropOptions } from "./drop-zone";

export type DriveBrowserProps = {
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
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const sharingChangedRef = useRef(false);
  const revalidator = useRevalidator();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  async function download(items: DriveItem[]) {
    setDownloading(true);
    await downloadItems(items, { toast, open: (url) => window.location.assign(url) });
    setDownloading(false);
  }

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
      onDownload: (item: DriveItem) => void download(inSelection(item) ? selectedItems : [item]),
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
        if (item.type === "file") {
          setShareTarget({ kind: "file", id: item.id, title: item.title || "Untitled" });
          onShareItem?.(item);
          return;
        }
        if (item.type !== "doc" && item.type !== "folder" && item.type !== "form") return;
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
        setShareTarget({ kind: "page", id: item.id, title: item.title || "Untitled", workspaceType: wt });
        onShareItem?.(item);
      },
    };
  }

  // ── Selection state ────────────────────────────────────────────────────────
  // One model for every view. `selected` is what bulk actions apply to,
  // `anchorId` is where a shift-click range starts, and `focusId` is the row the
  // keyboard, Quick Look and rename talk about: the last one clicked, checked
  // or arrowed to.
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
  const allHits = useMemo(
    () => (searching ? searchAll(scopes, search, typeFilter, tagFilter) : []),
    [searching, scopes, search, typeFilter, tagFilter],
  );
  const tagFilterRef = useRef({ fn: tagFilter, generation: 0 });
  if (tagFilterRef.current.fn !== tagFilter) {
    tagFilterRef.current = { fn: tagFilter, generation: tagFilterRef.current.generation + 1 };
  }
  const { visible: hits, pager: hitsPager } = useClientSlice(allHits, {
    resetKey: JSON.stringify([search, tagFilterRef.current.generation, typeFilter]),
  });

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

  // The drives themselves are focusable (arrow keys walk them) but never selected.
  const scopesFocusable = !searching && (columnsActive || !currentScope);

  const {
    selected, setSelected, anchorId, focusId, focusEntry, selectedItems,
    clearSelection, focusOnly, selectIds, selectWithModifier, handleContextSelect,
  } = useDriveSelection({
    itemIndex,
    scopes,
    scopesFocusable,
    listing,
    currentScopeId,
    currentFolderId,
    initialSelectedId,
    revealId,
    followRow: (id) => {
      const level = levelIndexOf(id);
      if (level > 0) setFocusLevel(level);
    },
  });

  // Follow the keyboard: bring the focused row into view (horizontally as well,
  // since a deep trail scrolls the columns off-screen).
  useEffect(() => {
    if (!focusId) return;
    const id = CSS.escape(focusId);
    rootRef.current
      ?.querySelector(`[data-row-id="${id}"], [data-item-id="${id}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusId]);

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

  const { onPaneKeyDown } = useDriveKeyboard({
    searching, columnsActive, viewMode, hits, listing, scopes, currentScope, levels, focusLevel, setFocusLevel,
    levelRows, itemsForLevel, itemIndex, focusId, focusEntry, selectedItems, focusOnly, clearSelection, setSelected,
    previewItem, setPreviewItem, listRef, goUp, openById, openFolderInColumn, onOpenItem, onBulkDelete, getInternalScopeActions,
  });

  const {
    sensors, activeDrag, uploadOver, fileOverFolder, draggedItemsFor,
    handleDragStart, handleDragEnd, onFileDragEnter, onFileDragOver, onFileDragLeave, onFileDrop,
  } = useDriveDnd({ scopes, currentScope, searching, hits, selected, selectedItems, suppressNextClick, dropOnNotebook, onMove, onMoveToScope, onUploadFiles });

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
                            : <EmptyState className="py-6">This folder is empty.</EmptyState>
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
            <>
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
              {searching && (
                <div onClick={(e) => e.stopPropagation()}>
                  <LoadMore {...hitsPager} />
                </div>
              )}
            </>
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
            onBulkDownload={() => void download(selectedItems)}
            downloading={downloading}
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
        target={shareTarget}
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
