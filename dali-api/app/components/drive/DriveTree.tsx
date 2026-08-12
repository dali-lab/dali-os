// DriveTree — a unified, movable tree for one Drive scope.
//
// Renders folders, docs, files, and forms in a single collapsible tree. Items
// at the root (parentFolderId === null) appear at the top level; items inside a
// folder appear when that folder is expanded. Arbitrary nesting depth — the
// 2-level UI cap from the old documents hub is not imposed here.
//
// DND: uses dnd-kit (same lib as FormsBrowser). Each item is a draggable; each
// folder row and the root drop zone are droppables. The drag data carries
// { item, scopeId } so the parent hub's onMove handler can compare source vs
// destination scope for cross-scope moves. Cross-scope moves are guarded with a
// loud confirm (see DriveHub); same-scope moves call the right endpoint directly.
//
// Cycle guard: dropping a folder into its own descendant is silently rejected
// client-side (descendantSetOf — same guard FormsBrowser uses).

import { useMemo, useRef, useState, type MouseEvent } from "react";
import { Link } from "react-router";
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
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileSignature,
  Folder,
  Paperclip,
} from "lucide-react";
import type { DriveItem } from "~/lib/drive.server";
import { PageIcon } from "~/components/PageIcon";

// The unique id used as dnd-kit droppable/draggable ids. We prefix with the
// scopeId so ids stay globally unique when two DriveTree instances share the
// same DndContext in the hub (each scope renders its own DndContext today, so
// this is just belt-and-suspenders).
function dndId(scopeId: string, itemId: string) {
  return `${scopeId}::${itemId}`;
}

// The payload carried by every draggable and every droppable.
export type DragPayload = {
  item: DriveItem;
  scopeId: string;
};
export type DropPayload = {
  // The folder to drop INTO. null = the root of the scope.
  destFolderId: string | null;
  destScopeId: string;
};

// Build the set of all descendant folder ids of `folderId` (including itself)
// from the flat DriveItem list. Used to prevent a folder from being dropped
// into its own subtree.
function folderDescendants(items: DriveItem[], folderId: string): Set<string> {
  const childMap = new Map<string, string[]>();
  for (const it of items) {
    if (it.type !== "folder") continue;
    const p = it.parentFolderId ?? "_root_";
    const list = childMap.get(p);
    if (list) list.push(it.id);
    else childMap.set(p, [it.id]);
  }
  const result = new Set([folderId]);
  const queue = [folderId];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const child of childMap.get(cur) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// Root drop zone — the full-width band at the top of a scope's tree that
// accepts drags back to the scope root (parentFolderId = null).
function RootDropZone({
  scopeId,
  isActive,
}: {
  scopeId: string;
  isActive: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: dndId(scopeId, "_root_"),
    data: { destFolderId: null, destScopeId: scopeId } satisfies DropPayload,
  });

  // Only show the zone while a drag is active so it doesn't eat vertical space.
  if (!isActive) return null;
  return (
    <div
      ref={setNodeRef}
      className={`h-6 rounded-md transition-colors mb-1 flex items-center justify-center text-[11px] text-muted-foreground ${
        isOver ? "bg-accent-coral/10 ring-1 ring-accent-coral/40 text-accent-coral" : "bg-muted/30"
      }`}
    >
      {isOver ? "Drop to move to root" : "Drop here for root level"}
    </div>
  );
}

// A single leaf item row (doc, file, or form).
function LeafRow({
  item,
  scopeId,
  depth,
  suppressClickRef,
}: {
  item: DriveItem;
  scopeId: string;
  depth: number;
  suppressClickRef: React.MutableRefObject<boolean>;
}) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: dndId(scopeId, item.id),
    data: { item, scopeId } satisfies DragPayload,
  });

  function guardClick(e: MouseEvent) {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = false;
    }
  }

  const icon =
    item.type === "file" ? (
      <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    ) : item.type === "form" ? (
      <ClipboardList className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    ) : item.type === "agreement" ? (
      <FileSignature className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    ) : (
      <PageIcon iconEmoji={item.iconEmoji} />
    );

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      data-testid={`drive-item-${item.type}-${item.id}`}
      style={{
        paddingLeft: 8 + depth * 16,
        ...(transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, transition: "none" }
          : {}),
      }}
      className={`py-2 flex items-center gap-2 text-sm group cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <span {...listeners} className="flex items-center gap-2 min-w-0 flex-1">
        {icon}
        <Link
          to={item.href}
          onClick={guardClick}
          className="truncate font-medium text-foreground hover:text-accent-coral transition-colors"
        >
          {item.title || "Untitled"}
        </Link>
      </span>
    </div>
  );
}

// A folder row that is both draggable (can be moved) and a drop target for its
// contents. Clicking the chevron/name expands/collapses inline.
function FolderRow({
  item,
  scopeId,
  depth,
  children,
  allItems,
  suppressClickRef,
}: {
  item: DriveItem & { type: "folder" };
  scopeId: string;
  depth: number;
  children: DriveItem[];
  allItems: DriveItem[];
  suppressClickRef: React.MutableRefObject<boolean>;
}) {
  const [expanded, setExpanded] = useState(true);

  // Draggable (the folder itself can be moved into another folder).
  const drag = useDraggable({
    id: dndId(scopeId, item.id),
    data: { item, scopeId } satisfies DragPayload,
  });
  // Droppable (items can be dropped into this folder).
  const drop = useDroppable({
    id: dndId(scopeId, `folder-drop::${item.id}`),
    data: { destFolderId: item.id, destScopeId: scopeId } satisfies DropPayload,
  });

  // Attach both refs to the same element — same pattern as FormsBrowser's
  // FolderCardView (combine drag+drop on one node).
  function setRefs(node: HTMLDivElement | null) {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  }

  function guardClick(e: MouseEvent) {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = false;
    }
  }

  return (
    <div
      data-testid={`drive-folder-${item.id}`}
      style={{
        ...(drag.transform
          ? {
              transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)`,
              transition: "none",
            }
          : {}),
      }}
      className={drag.isDragging ? "opacity-40" : ""}
    >
      <div
        ref={setRefs}
        {...drag.attributes}
        style={{ paddingLeft: 8 + depth * 16 }}
        className={`py-2 flex items-center gap-1.5 text-sm rounded-md cursor-grab active:cursor-grabbing ${
          drop.isOver ? "bg-accent-coral/10 ring-1 ring-accent-coral/40" : ""
        }`}
      >
        <button
          type="button"
          {...drag.listeners}
          onClick={(e) => {
            guardClick(e);
            if (!suppressClickRef.current) setExpanded((v) => !v);
          }}
          aria-expanded={expanded}
          className="flex items-center gap-1.5 text-left font-medium text-foreground min-w-0 flex-1"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
          <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">
            {item.iconEmoji ? `${item.iconEmoji} ` : ""}
            {item.title || "Untitled"}
          </span>
          {!expanded && children.length > 0 && (
            <span className="text-[11px] text-muted-foreground shrink-0">
              ({children.length})
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col divide-y divide-border/50">
          {children.length === 0 ? (
            <p
              style={{ paddingLeft: 8 + (depth + 1) * 16 }}
              className="py-1.5 text-xs text-muted-foreground italic"
            >
              Empty
            </p>
          ) : (
            <TreeLevel
              items={allItems}
              parentFolderId={item.id}
              scopeId={scopeId}
              depth={depth + 1}
              allItems={allItems}
              suppressClickRef={suppressClickRef}
            />
          )}
        </div>
      )}
    </div>
  );
}

// One level of the tree — renders all items whose parentFolderId matches the
// given value. Folders recurse; leaves are leaf rows.
function TreeLevel({
  items,
  parentFolderId,
  scopeId,
  depth,
  allItems,
  suppressClickRef,
}: {
  items: DriveItem[];
  parentFolderId: string | null;
  scopeId: string;
  depth: number;
  allItems: DriveItem[];
  suppressClickRef: React.MutableRefObject<boolean>;
}) {
  const level = items.filter((it) => it.parentFolderId === parentFolderId);
  // Folders before non-folders, then alphabetical within each group.
  const sorted = [...level].sort((a, b) => {
    const fa = a.type === "folder" ? 0 : 1;
    const fb = b.type === "folder" ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return (a.title || "").localeCompare(b.title || "");
  });

  return (
    <>
      {sorted.map((it) =>
        it.type === "folder" ? (
          <FolderRow
            key={it.id}
            item={it}
            scopeId={scopeId}
            depth={depth}
            allItems={allItems}
            children={allItems.filter((c) => c.parentFolderId === it.id)}
            suppressClickRef={suppressClickRef}
          />
        ) : (
          <LeafRow
            key={it.id}
            item={it}
            scopeId={scopeId}
            depth={depth}
            suppressClickRef={suppressClickRef}
          />
        ),
      )}
    </>
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

export type DriveTreeMoveArgs = {
  item: DriveItem;
  srcScopeId: string;
  destFolderId: string | null;
  destScopeId: string;
};

export function DriveTree({
  scopeId,
  items,
  onMove,
}: {
  /** Stable identifier for this scope, e.g. "lab" or the projectId. */
  scopeId: string;
  items: DriveItem[];
  /**
   * Called when the user drops an item into a new location. The parent hub is
   * responsible for deciding whether this is same-scope (post directly) or
   * cross-scope (show confirm first).
   */
  onMove: (args: DriveTreeMoveArgs) => void;
}) {
  const [dragging, setDragging] = useState<DragPayload | null>(null);

  // 6px activation distance — same as FormsBrowser to disambiguate click from
  // drag on rows that are also links.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // After a drag ends, dnd-kit synthesizes a native click on the drag source
  // (pointerup → click). Swallow it so link rows don't navigate.
  const suppressClickRef = useRef(false);
  function endDrag() {
    setDragging(null);
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  // All folder ids in this scope — needed for the cyclic-move guard.
  const folderIds = useMemo(
    () => new Set(items.filter((i) => i.type === "folder").map((i) => i.id)),
    [items],
  );

  function handleDragStart(e: DragStartEvent) {
    setDragging((e.active.data.current as DragPayload | undefined) ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    endDrag();
    const src = e.active.data.current as DragPayload | undefined;
    const dest = e.over?.data.current as DropPayload | undefined;
    if (!src || !dest) return;

    // Cycle guard: a folder cannot be dropped into its own descendant (or
    // itself). Only applies when the dragged item is a folder.
    if (src.item.type === "folder" && dest.destFolderId !== null) {
      const descendants = folderDescendants(items, src.item.id);
      if (descendants.has(dest.destFolderId)) return;
    }

    // No-op: already in this exact folder.
    if (src.item.parentFolderId === dest.destFolderId && src.scopeId === dest.destScopeId) return;

    onMove({
      item: src.item,
      srcScopeId: src.scopeId,
      destFolderId: dest.destFolderId,
      destScopeId: dest.destScopeId,
    });
  }

  const isEmpty = items.length === 0;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {isEmpty ? (
        <p className="py-4 text-sm text-muted-foreground italic">Nothing here yet.</p>
      ) : (
        <div className="flex flex-col" data-testid="drive-tree">
          <RootDropZone scopeId={scopeId} isActive={!!dragging} />
          <div className="flex flex-col divide-y divide-border/60">
            <TreeLevel
              items={items}
              parentFolderId={null}
              scopeId={scopeId}
              depth={0}
              allItems={items}
              suppressClickRef={suppressClickRef}
            />
          </div>
        </div>
      )}
    </DndContext>
  );
}
