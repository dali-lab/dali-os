import { useRef, useState, type DragEvent } from "react";
import { MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import type { DriveItem } from "~/drive/lib/drive.server";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { droppedFiles } from "~/components/drive/dropped-files";
import { folderDescendants } from "~/components/drive/browser-items";
import { fileDropFolderAt, type FileDropOptions } from "~/components/drive/drop-zone";

type DragSource = { item: DriveItem; scopeId: string };

export type DriveDndOptions = {
  scopes: DriveTreeScope[];
  currentScope: DriveTreeScope | null;
  searching: boolean;
  hits: { item: DriveItem; scope: { id: string } }[];
  selected: Set<string>;
  selectedItems: DriveItem[];
  suppressNextClick: () => void;
  dropOnNotebook: (notebook: DriveItem, dragged: DriveItem[]) => void | Promise<void>;
  onMove: (scopeId: string, items: DriveItem[], destFolderId: string | null) => void;
  onMoveToScope?: (fromScopeId: string, toScopeId: string, items: DriveItem[]) => void;
  onUploadFiles?: (files: File[], options?: FileDropOptions) => void;
};

/** Row drags (dnd-kit moves) and desktop-file drags (drag-to-upload). */
export function useDriveDnd(o: DriveDndOptions) {
  const [uploadOver, setUploadOver] = useState(false);
  const [fileOverFolder, setFileOverFolder] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<DragSource | null>(null);
  const dragDepth = useRef(0);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function handleDragStart(e: DragStartEvent) {
    setActiveDrag((e.active.data.current as DragSource | undefined) ?? null);
  }

  /** Dragging a row inside a multi-selection drags the selection; a search selection can span drives, so only the dragged row's drive comes along. */
  function draggedItemsFor(src: DragSource): DriveItem[] {
    if (!o.selected.has(src.item.id) || o.selectedItems.length < 2) return [src.item];
    const items = o.searching
      ? o.hits.filter((h) => h.scope.id === src.scopeId && o.selected.has(h.item.id)).map((h) => h.item)
      : o.selectedItems;
    return items.length > 1 ? items : [src.item];
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    o.suppressNextClick();
    const src = e.active.data.current as DragSource | undefined;
    const dest = e.over?.data.current as
      | { destFolderId?: string | null; destNotebookId?: string; destScopeId?: string }
      | undefined;
    if (!src || !dest) return;
    const dragged = draggedItemsFor(src);
    if (dest.destNotebookId) {
      const notebook = o.scopes.flatMap((sc) => sc.items).find((it) => it.id === dest.destNotebookId);
      if (notebook && !dragged.some((d) => d.id === notebook.id)) void o.dropOnNotebook(notebook, dragged);
      return;
    }
    if (dest.destScopeId && dest.destFolderId === undefined) {
      if (dest.destScopeId !== src.scopeId) {
        o.onMoveToScope?.(src.scopeId, dest.destScopeId, dragged);
      }
      return;
    }
    // The scope comes from the drop target: the browsed scope can lag a drop made in a column opened before the last navigation.
    const destScopeId = dest.destScopeId ?? o.currentScope?.id ?? null;
    if (!destScopeId) return;
    if (destScopeId !== src.scopeId) {
      o.onMoveToScope?.(src.scopeId, destScopeId, dragged);
      return;
    }
    const destScope = o.scopes.find((sc) => sc.id === destScopeId);
    if (!destScope) return;
    const movable = dragged.filter((item) => {
      if (item.id === dest.destFolderId) return false;
      if (item.type === "folder" && dest.destFolderId) {
        if (folderDescendants(destScope.items, item.id).has(dest.destFolderId)) return false;
      }
      return item.parentFolderId !== (dest.destFolderId ?? null);
    });
    if (movable.length === 0) return;
    o.onMove(destScope.id, movable, dest.destFolderId ?? null);
  }

  const canUpload = !!(o.currentScope && o.onUploadFiles && !o.searching);
  function hasFiles(e: DragEvent) {
    return Array.from(e.dataTransfer.types || []).includes("Files");
  }
  function onFileDragEnter(e: DragEvent) {
    if (!canUpload || !hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setUploadOver(true);
    setFileOverFolder(fileDropFolderAt(e));
  }
  function onFileDragOver(e: DragEvent) {
    if (!canUpload || !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setFileOverFolder(fileDropFolderAt(e));
  }
  function onFileDragLeave(e: DragEvent) {
    if (!canUpload || !hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setUploadOver(false);
      setFileOverFolder(null);
    }
  }
  function onFileDrop(e: DragEvent) {
    if (!canUpload || !hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setUploadOver(false);
    setFileOverFolder(null);
    const { files, skippedFolders } = droppedFiles(e.dataTransfer);
    if (!o.onUploadFiles || (files.length === 0 && skippedFolders === 0)) return;
    const folderId = fileDropFolderAt(e);
    const options: FileDropOptions = {
      ...(folderId ? { folderId } : {}),
      ...(skippedFolders > 0 ? { skippedFolders } : {}),
    };
    if (Object.keys(options).length > 0) o.onUploadFiles(files, options);
    else o.onUploadFiles(files);
  }

  return {
    sensors,
    activeDrag,
    uploadOver,
    fileOverFolder,
    draggedItemsFor,
    handleDragStart,
    handleDragEnd,
    onFileDragEnter,
    onFileDragOver,
    onFileDragLeave,
    onFileDrop,
  };
}
