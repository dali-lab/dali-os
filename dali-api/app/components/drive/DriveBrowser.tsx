// DriveBrowser — a Finder / Google-Drive style browser for the unified Drive.
//
// Unlike the old inline expand/collapse DriveTree, this shows ONE location at a
// time: either the Drive root (the list of "drives" — My Drive, Lab, Core, each
// project) or the contents of a single scope+folder. You navigate INTO a folder
// by double-clicking it; a breadcrumb path shows where you are and lets you jump
// back up. Single click selects a row; double click opens it (folders/scopes
// navigate, leaves open their editor). A search box filters across every drive.
//
// The hub (drive.hub.tsx) owns the URL state (?scope=&folder=), the loader data,
// and the per-scope action factory. This component is the presentational surface
// plus same-scope drag-to-move (dnd-kit, onto folder rows and breadcrumb crumbs).

import { useMemo, useRef, useState, type MouseEvent } from "react";
import {
  DndContext,
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
  HardDrive,
  Search,
  X,
} from "lucide-react";
import type { DriveItem } from "~/lib/drive.server";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import { PageIcon } from "~/components/PageIcon";
import { Menu } from "~/components/ui/floating";
import { relativeTime } from "~/lib/relative-time";

// Row "⋯" handlers — the non-drag way to manage items (rename / move / delete).
// One set per scope; the hub supplies them via getScopeActions(scopeId).
export type RowActions = {
  onRename: (item: DriveItem) => void;
  onRequestMove: (item: DriveItem) => void;
  onDelete: (item: DriveItem) => void;
};

export type DriveBrowserProps = {
  /** Every drive the viewer can see (root listing + cross-drive search). */
  scopes: DriveTreeScope[];
  /** null = Drive root (list of drives); otherwise the drive being browsed. */
  currentScopeId: string | null;
  /** null = the scope's top level; otherwise the folder within it. */
  currentFolderId: string | null;
  /** Type filter chip value (all/doc/file/form/agreement). */
  typeFilter: "all" | "doc" | "file" | "form" | "agreement";
  /** Live search query (empty = browse mode). */
  search: string;
  onSearchChange: (q: string) => void;
  /** Navigate the browser. scopeId null → root; folderId null → scope top. */
  onNavigate: (scopeId: string | null, folderId: string | null) => void;
  /** Open a leaf item (doc/file/form/agreement) in its editor. */
  onOpenItem: (item: DriveItem) => void;
  /** Same-scope move (drag or "Move to…" resolves the destination folder). */
  onMove: (scopeId: string, item: DriveItem, destFolderId: string | null) => void;
  /** Row "⋯" actions for a given scope. */
  getScopeActions: (scopeId: string) => RowActions;
  /** Type-filter control rendered in the toolbar (the site's Select dropdown). */
  filterControl?: React.ReactNode;
  /** Contextual New menu, rendered at the toolbar's trailing edge. Null at root. */
  newMenu?: React.ReactNode;
};

// ── Pure helpers (client-safe; operate on the flat item list) ────────────────

// Immediate children of `folderId` (null = top level), folders first then
// leaves, alphabetical within each group — same ordering the old tree used.
export function childrenAt(items: DriveItem[], folderId: string | null): DriveItem[] {
  return items
    .filter((it) => it.parentFolderId === folderId)
    .sort((a, b) => {
      const fa = a.type === "folder" ? 0 : 1;
      const fb = b.type === "folder" ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return (a.title || "").localeCompare(b.title || "");
    });
}

// Walk parentFolderId up to the scope root, returning the folder chain
// (root-first). Mirrors walkFolderCrumbs in forms-data.ts.
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

export type SearchHit = {
  scope: DriveTreeScope;
  item: DriveItem;
  /** Human path, e.g. "Lab › Meeting notes". */
  path: string;
};

// Substring match over titles across all drives. Returns each hit with the
// drive label + folder path so results read like Drive's search list.
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

// ── Presentational bits ──────────────────────────────────────────────────────

function itemIcon(item: DriveItem) {
  switch (item.type) {
    case "folder":
      return <Folder className="w-4 h-4 text-accent-coral/80 shrink-0" />;
    case "file":
      return <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />;
    case "form":
      return <ClipboardList className="w-4 h-4 text-muted-foreground shrink-0" />;
    case "agreement":
      return <FileSignature className="w-4 h-4 text-muted-foreground shrink-0" />;
    default:
      return <PageIcon iconEmoji={item.iconEmoji} />;
  }
}

function scopeIcon(scope: DriveTreeScope) {
  if (scope.id === "mine") return <User className="w-4 h-4 text-muted-foreground shrink-0" />;
  if (scope.id === "core") return <Shield className="w-4 h-4 text-accent-coral/80 shrink-0" />;
  if (scope.id === "lab") return <Users className="w-4 h-4 text-muted-foreground shrink-0" />;
  if (scope.iconEmoji) return <span className="text-base leading-none shrink-0">{scope.iconEmoji}</span>;
  return <Folder className="w-4 h-4 text-accent-coral/80 shrink-0" />;
}

function RowActionsMenu({ item, actions }: { item: DriveItem; actions: RowActions }) {
  const canRename = item.type === "folder" || item.type === "doc" || item.type === "file";
  const canMove = item.type !== "agreement";
  const canDelete = item.type === "folder" || item.type === "doc" || item.type === "file";
  if (!canRename && !canMove && !canDelete) return null;
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
    </Menu>
  );
}

// One selectable/openable row inside a scope view. Draggable; folders are also
// drop targets. Single click selects, double click opens.
function ItemRow({
  item,
  scopeId,
  selected,
  onSelect,
  onOpen,
  actions,
  suppressClickRef,
}: {
  item: DriveItem;
  scopeId: string;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  actions: RowActions;
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

  function handleClick(e: MouseEvent) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    e.stopPropagation();
    onSelect();
  }

  return (
    <div
      ref={setRefs}
      {...drag.attributes}
      {...drag.listeners}
      data-testid={`drive-item-${item.type}-${item.id}`}
      onClick={handleClick}
      onDoubleClick={onOpen}
      style={
        drag.transform
          ? { transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)`, transition: "none" }
          : undefined
      }
      className={`group flex items-center gap-3 px-3 py-2 text-sm cursor-default select-none rounded-md ${
        drag.isDragging ? "opacity-40" : ""
      } ${
        drop.isOver && isFolder
          ? "bg-accent-coral/10 ring-1 ring-accent-coral/40"
          : selected
            ? "bg-accent-coral/10"
            : "hover:bg-muted/50"
      }`}
    >
      {itemIcon(item)}
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {item.title || "Untitled"}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums hidden sm:block">
        {relativeTime(item.updatedAt as unknown as string)}
      </span>
      <RowActionsMenu item={item} actions={actions} />
    </div>
  );
}

// A "drive" row at the Drive root. Not draggable/droppable — you can't move a
// drive. Double click enters it.
function ScopeRow({
  scope,
  selected,
  onSelect,
  onOpen,
}: {
  scope: DriveTreeScope;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const isCore = scope.id === "core";
  const isProject = scope.id !== "mine" && scope.id !== "lab" && !isCore;
  const label = scope.id === "mine" ? "My Drive" : scope.id === "lab" ? "Lab" : scope.label;
  return (
    <div
      data-testid={`drive-scope-${scope.id}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={onOpen}
      className={`group flex items-center gap-3 px-3 py-2.5 text-sm cursor-default select-none rounded-md ${
        selected ? "bg-accent-coral/10" : "hover:bg-muted/50"
      }`}
    >
      {scopeIcon(scope)}
      <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{label}</span>
      {isCore && (
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-accent-coral/70">Core only</span>
      )}
      {isProject && (
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-accent-coral/70">Project</span>
      )}
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </div>
  );
}

// A search-result row: type icon, title, and its drive/folder path. Opens on
// double click (folders navigate, leaves open).
function SearchRow({
  hit,
  selected,
  onSelect,
  onOpen,
  actions,
}: {
  hit: SearchHit;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  actions: RowActions;
}) {
  return (
    <div
      data-testid={`drive-search-hit-${hit.item.id}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={onOpen}
      className={`group flex items-center gap-3 px-3 py-2 text-sm cursor-default select-none rounded-md ${
        selected ? "bg-accent-coral/10" : "hover:bg-muted/50"
      }`}
    >
      {itemIcon(hit.item)}
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground">{hit.item.title || "Untitled"}</span>
        <span className="ml-2 text-xs text-muted-foreground truncate">{hit.path}</span>
      </span>
      <RowActionsMenu item={hit.item} actions={actions} />
    </div>
  );
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
  filterControl,
  newMenu,
}: DriveBrowserProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const currentScope = useMemo(
    () => scopes.find((s) => s.id === currentScopeId) ?? null,
    [scopes, currentScopeId],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  // Folder-and-descendants set for the cyclic-move guard within a scope.
  function descendants(items: DriveItem[], folderId: string): Set<string> {
    const childMap = new Map<string, string[]>();
    for (const it of items) {
      if (it.type !== "folder") continue;
      const p = it.parentFolderId ?? "_root_";
      (childMap.get(p) ?? childMap.set(p, []).get(p)!).push(it.id);
    }
    const out = new Set([folderId]);
    const queue = [folderId];
    while (queue.length) {
      const cur = queue.pop()!;
      for (const c of childMap.get(cur) ?? []) if (!out.has(c)) (out.add(c), queue.push(c));
    }
    return out;
  }

  function handleDragStart(_e: DragStartEvent) {
    setDragging(true);
  }
  function handleDragEnd(e: DragEndEvent) {
    setDragging(false);
    suppressClickRef.current = true;
    setTimeout(() => (suppressClickRef.current = false), 0);
    const src = e.active.data.current as { item: DriveItem; scopeId: string } | undefined;
    const dest = e.over?.data.current as { destFolderId: string | null; destScopeId: string } | undefined;
    if (!src || !dest || !currentScope) return;
    if (src.item.type === "folder" && dest.destFolderId !== null) {
      if (descendants(currentScope.items, src.item.id).has(dest.destFolderId)) return;
    }
    if (src.item.parentFolderId === dest.destFolderId) return;
    onMove(currentScope.id, src.item, dest.destFolderId);
  }

  // Search takes over the listing when there's a query.
  const searching = search.trim().length > 0;
  const hits = useMemo(
    () => (searching ? searchAll(scopes, search, typeFilter) : []),
    [searching, scopes, search, typeFilter],
  );

  // Breadcrumb: Drive › scope › folder chain. Root shows just "Drive".
  const folderCrumbs = currentScope ? crumbsFor(currentScope.items, currentFolderId) : [];

  // Current listing (browse mode). At root: the drives. In a scope: filtered
  // children of the current folder (folders always kept as navigation skeleton).
  const listing = currentScope
    ? childrenAt(currentScope.items, currentFolderId).filter(
        (it) => typeFilter === "all" || it.type === "folder" || it.type === typeFilter,
      )
    : [];

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-3" data-testid="drive-browser" onClick={() => setSelectedId(null)}>
      {/* Toolbar: breadcrumb path + search */}
      <div className="flex items-center gap-3 flex-wrap">
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
          {folderCrumbs.map((c) => (
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

        {filterControl}

        <div className="relative w-full sm:w-64 shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="search"
            value={search}
            data-testid="drive-search"
            onClick={(e) => e.stopPropagation()}
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

        {newMenu}
      </div>

      {/* Listing */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {searching ? (
          hits.length === 0 ? (
            <EmptyLine>No matches for “{search.trim()}”.</EmptyLine>
          ) : (
            <div className="flex flex-col divide-y divide-border/50 p-1" data-testid="drive-search-results">
              {hits.map((hit) => (
                <SearchRow
                  key={`${hit.scope.id}:${hit.item.id}`}
                  hit={hit}
                  selected={selectedId === hit.item.id}
                  onSelect={() => setSelectedId(hit.item.id)}
                  onOpen={() =>
                    hit.item.type === "folder"
                      ? onNavigate(hit.scope.id, hit.item.id)
                      : onOpenItem(hit.item)
                  }
                  actions={getScopeActions(hit.scope.id)}
                />
              ))}
            </div>
          )
        ) : !currentScope ? (
          // Drive root — list the drives.
          scopes.length === 0 ? (
            <EmptyLine>Your Drive is empty.</EmptyLine>
          ) : (
            <div className="flex flex-col divide-y divide-border/50 p-1">
              {scopes.map((scope) => (
                <ScopeRow
                  key={scope.id}
                  scope={scope}
                  selected={selectedId === scope.id}
                  onSelect={() => setSelectedId(scope.id)}
                  onOpen={() => onNavigate(scope.id, null)}
                />
              ))}
            </div>
          )
        ) : (
          // Inside a scope/folder.
          listing.length === 0 ? (
            <EmptyLine>This folder is empty.</EmptyLine>
          ) : (
            <div className="flex flex-col divide-y divide-border/50 p-1" data-testid="drive-listing">
              {listing.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  scopeId={currentScope.id}
                  selected={selectedId === item.id}
                  onSelect={() => setSelectedId(item.id)}
                  onOpen={() =>
                    item.type === "folder"
                      ? onNavigate(currentScope.id, item.id)
                      : onOpenItem(item)
                  }
                  actions={getScopeActions(currentScope.id)}
                  suppressClickRef={suppressClickRef}
                />
              ))}
            </div>
          )
        )}
      </div>
      </div>
    </DndContext>
  );
}

// A single breadcrumb segment. Doubles as a drop target so you can drag an item
// onto an ancestor to move it up/out.
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

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-6 text-center text-sm text-muted-foreground italic">{children}</p>;
}
