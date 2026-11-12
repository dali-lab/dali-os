import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useOpenBeside } from "~/components/side-panel/use-side-panel";
import { useNavigate, useRevalidator } from "react-router";
import { Select, Menu } from "~/components/ui/floating";
import {
  Folder,
  FolderPlus,
  ChevronDown,
  FileText,
  Paperclip,
  Plus,
  Upload,
  NotebookPen,
  Presentation,
  Shapes,
} from "lucide-react";
import type { DriveTypeFilter } from "~/components/drive/type-filter";
import { setPageFavorite } from "~/components/favorites-live";
import { cn } from "~/lib/cn";
import { useDialog } from "~/components/ui/dialog";
import { Toggle } from "~/components/ui/Toggle";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";
import { DriveBrowser } from "~/components/drive/DriveBrowser";
import type { RowActions } from "~/components/drive/DriveBrowser";
import { DRIVE_TOOLBAR_BTN } from "~/components/drive/toolbar";
import { FolderPicker } from "~/components/drive/FolderPicker";
import type { PickerDrive, PickerFolder, Destination } from "~/components/drive/FolderPicker";
import { moveDriveItem, driveErrorFrom } from "~/components/drive/move-item";
import { destinationLabel } from "~/components/drive/action-toast";
import { reportMoveBatch, runHiddenMoveBatch, itemCount } from "~/components/drive/move-batch";
import { withoutHidden, usePendingHidden } from "~/components/drive/pending-hidden";
import { runTrash } from "~/components/drive/trash-batch";
import { DriveHistoryContext, useDriveHistory, useDriveHistoryKeys } from "~/components/drive/use-drive-history";
import { useDriveFileUpload } from "~/components/drive/useDriveFileUpload";
import { DriveUploadInput } from "~/components/drive/DriveUploadInput";
import { useToast } from "~/components/ui/toast";
import { filterPillClass } from "~/components/ui/floating/styles";

// Project drives hold docs, folders and files. Folders are always shown (the
// browser never filters them out), so the filter only needs the leaf kinds.
type ProjectDriveTypeFilter = Extract<DriveTypeFilter, "all" | "doc" | "notebook" | "whiteboard" | "slides" | "file">;
const PROJECT_TYPE_FILTERS: { value: ProjectDriveTypeFilter; label: string; icon?: ReactNode }[] = [
  { value: "all", label: "All types" },
  { value: "doc", label: "Documents", icon: <FileText className="w-3.5 h-3.5" /> },
  { value: "notebook", label: "Notebooks", icon: <NotebookPen className="w-3.5 h-3.5" /> },
  { value: "whiteboard", label: "Whiteboards", icon: <Shapes className="w-3.5 h-3.5" /> },
  { value: "slides", label: "Slide decks", icon: <Presentation className="w-3.5 h-3.5" /> },
  { value: "file", label: "Files", icon: <Paperclip className="w-3.5 h-3.5" /> },
];
// Ids of a folder plus everything under it — a folder can't be moved into its
// own subtree, so these are disabled in the move picker.
export function folderSubtree(items: DriveItem[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const it of items) {
    if (!it.parentFolderId) continue;
    const arr = childrenOf.get(it.parentFolderId) ?? [];
    arr.push(it.id);
    childrenOf.set(it.parentFolderId, arr);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of childrenOf.get(cur) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}
export function ProjectDriveTab({
  projectId,
  projectDriveScope,
  canEdit,
  hasActivePartner,
  receiverViewer,
}: {
  projectId: string;
  projectDriveScope: DriveTreeScope;
  canEdit: boolean;
  hasActivePartner: boolean;
  receiverViewer?: { isCore: boolean; isProjectMember: boolean };
}) {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<ProjectDriveTypeFilter>("all");
  const scopeId = projectDriveScope.id;
  const revalidate = useCallback(() => revalidator.revalidate(), [revalidator]);
  const history = useDriveHistory({ onChange: revalidate });
  useDriveHistoryKeys(history);
  const pendingHidden = usePendingHidden(revalidator.state, projectDriveScope);
  const visibleScopes = useMemo(
    () => withoutHidden([projectDriveScope], pendingHidden.ids),
    [projectDriveScope, pendingHidden.ids],
  );

  // Upload into the current project folder via the shared presign→register flow
  // (identical path to the main Drive hub — see useDriveFileUpload).
  const uploadTarget = useMemo(
    () => ({ scope: { kind: "Project" as const, projectId }, folderPageId: currentFolderId }),
    [projectId, currentFolderId],
  );
  const { inputRef, uploading, uploadError, handleFileChange, uploadFiles } = useDriveFileUpload(
    uploadTarget,
    revalidate,
  );

  // Move-destination picker (single project scope). pickMoveDestination opens it
  // and resolves with the chosen Destination (or null on cancel).
  const [movePicker, setMovePicker] = useState<{
    heading: string;
    drives: PickerDrive[];
    folders: PickerFolder[];
    disabledFolderIds?: Set<string>;
    disabledDest?: Destination;
    initial?: Destination;
  } | null>(null);
  const movePickerResolve = useRef<((d: Destination | null) => void) | null>(null);
  const resolveMovePicker = useCallback((d: Destination | null) => {
    setMovePicker(null);
    movePickerResolve.current?.(d);
    movePickerResolve.current = null;
  }, []);

  // Sync doc-title changes made in the split-pane editor back to this listing.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; pageId?: string } | undefined;
      if (data?.type !== "dali:documentTitleChanged") return;
      const pageIds = new Set(projectDriveScope.items.map((i) => i.id));
      if (!data.pageId || !pageIds.has(data.pageId)) return;
      revalidator.revalidate();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [projectDriveScope.items, revalidator]);

  // Toggle partner visibility for a page (doc/folder). Posts to the
  // partner-visibility endpoint, then revalidates so the badge updates.
  const togglePagePartnerVisible = useCallback(async (item: DriveItem, next: boolean) => {
    if (item.type !== "doc" && item.type !== "file") return;
    if (next) {
      const confirmed = await dialog.confirm({
        title: "Share with partner?",
        description:
          "Partner organization members will be able to view this item. This takes effect immediately.",
        confirmLabel: "Share",
      });
      if (!confirmed) return;
    }
    const endpoint =
      item.type === "file"
        ? `/api/files/${item.id}/partner-visible`
        : `/api/pages/${item.id}/partner-visible`;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerVisible: next }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to update sharing");
      }
      revalidator.revalidate();
    } catch {
      // Silently fail — the user can retry. The badge state is loader-authoritative.
    }
  }, [dialog, revalidator]);

  const onNavigate = useCallback(
    (_scopeId: string | null, folderId: string | null) => {
      setCurrentFolderId(folderId);
    },
    [],
  );

  const onOpenBeside = useOpenBeside();
  const onOpenItem = useCallback(
    (item: DriveItem) => {
      if (!item.href) return;
      if (item.type === "doc") onOpenBeside({ href: item.href });
      else navigate(item.href);
    },
    [navigate, onOpenBeside],
  );

  // One item's move, with no reporting: the batch below speaks for the
  // selection. `onError` gets the reason a move was refused.
  const moveOne = useCallback(
    async (item: DriveItem, destFolderId: string | null, onError?: (message: string) => void): Promise<boolean> => {
      // Both endpoints (and what each calls its destination field) live in
      // move-item.ts, shared with the Drive hub — this embed had its own copy
      // and it drifted out of step with the pages endpoint's schema.
      try {
        const res = await moveDriveItem(item, destFolderId);
        if (res.ok) return true;
        onError?.((await driveErrorFrom(res)) ?? "Couldn't move");
        return false;
      } catch {
        onError?.("Couldn't move");
        return false;
      }
    },
    [],
  );

  // Move a selection into a folder (null = the project's top level): hide the
  // rows, move them one by one, then revalidate and report once.
  const moveItems = useCallback(
    async (items: DriveItem[], destFolderId: string | null) => {
      let failure: string | undefined;
      const landed = await runHiddenMoveBatch(
        items,
        (item) =>
          moveOne(item, destFolderId, (message) => {
            failure ??= message;
          }),
        pendingHidden,
      );
      reportMoveBatch(
        { toast, history, revalidate },
        {
          landed,
          total: items.length,
          destination: destinationLabel(projectDriveScope, destFolderId),
          forward: (l) => moveOne(l.item, destFolderId),
          back: (l) => moveOne({ ...l.item, parentFolderId: destFolderId }, l.folderId),
          failure: items.length === 1 ? failure : undefined,
        },
      );
    },
    [moveOne, pendingHidden, toast, history, revalidate, projectDriveScope],
  );

  // Dropping a selection onto a folder. Dragging one row of a multi-selection
  // brings the whole selection, so this takes a list.
  const onMove = useCallback(
    (_scopeId: string, items: DriveItem[], destFolderId: string | null) => moveItems(items, destFolderId),
    [moveItems],
  );

  // Open the destination picker over this project's folders and resolve with the
  // chosen destination (or null on cancel).
  const pickMoveDestination = useCallback(
    (item: DriveItem, heading: string): Promise<Destination | null> => {
      const rootId = projectDriveScope.rootFolderId ?? null;
      const drives: PickerDrive[] = [
        {
          id: scopeId,
          label: projectDriveScope.label,
          iconEmoji: projectDriveScope.iconEmoji,
          audience: projectDriveScope.scopeAudience ?? null,
        },
      ];
      // One pass gives every folder its child count, so a row can say what's
      // inside it rather than only its name.
      const childCount = new Map<string, number>();
      for (const it of projectDriveScope.items) {
        if (it.parentFolderId === null) continue;
        childCount.set(it.parentFolderId, (childCount.get(it.parentFolderId) ?? 0) + 1);
      }
      const folders: PickerFolder[] = projectDriveScope.items
        .filter((f) => f.type === "folder")
        .map((f) => ({
          id: f.id,
          driveId: scopeId,
          parentId: (f.parentFolderId ?? null) === rootId ? null : f.parentFolderId,
          title: f.title,
          iconEmoji: f.iconEmoji,
          itemCount: childCount.get(f.id) ?? 0,
        }));
      const banned = item.type === "folder" ? folderSubtree(projectDriveScope.items, item.id) : undefined;
      const currentFolder = (item.parentFolderId ?? null) === rootId ? null : (item.parentFolderId ?? null);
      const currentDest: Destination = { driveId: scopeId, folderId: currentFolder };
      return new Promise<Destination | null>((resolve) => {
        movePickerResolve.current = resolve;
        setMovePicker({
          heading,
          drives,
          folders,
          disabledFolderIds: banned,
          disabledDest: currentDest,
          initial: currentDest,
        });
      });
    },
    [scopeId, projectDriveScope, resolveMovePicker],
  );

  const getScopeActions = useCallback(
    (_scopeId: string): RowActions => ({
      onRename: async (item) => {
        const next = await dialog.prompt({
          title: "Rename",
          label: "Name",
          defaultValue: item.title || "",
          confirmLabel: "Save",
          validate: (v) => (v.trim() ? null : "Enter a name"),
        });
        if (next === null) return;
        const title = next.trim();
        if (title === item.title) return;
        const isFile = item.type === "file";
        const res = isFile
          ? await fetch(`/api/files/${item.id}`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intent: "rename", title }),
            })
          : await fetch(`/api/documents/${item.id}`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title }),
            });
        if (res.ok) revalidate();
        else toast.error("Couldn't rename");
      },
      onRequestMove: async (item) => {
        const dest = await pickMoveDestination(item, `Move "${item.title || "Untitled"}"`);
        if (dest) await onMove(scopeId, [item], dest.folderId);
      },
      onDelete: async (item) => {
        const ok = await dialog.confirm({
          title: `Delete "${item.title || "this item"}"?`,
          description:
            item.type === "folder"
              ? "The folder must be empty first."
              : "This moves it to the trash.",
          tone: "destructive",
          confirmLabel: "Delete",
        });
        if (!ok) return;
        await runTrash({ items: [item], deleteOne: deleteDriveItemRequest, hiding: pendingHidden, history, toast, revalidate });
      },
    }),
    [dialog, toast, revalidate, pickMoveDestination, onMove, scopeId, pendingHidden, history],
  );

  const onToggleFavorite = useCallback(
    async (item: DriveItem) => {
      if (item.type !== "doc" && item.type !== "folder") return;
      await setPageFavorite(item.id, !item.favorited);
      revalidate();
    },
    [revalidate],
  );

  // Create a doc/folder into the current project folder (or the project root).
  const createPage = useCallback(
    async (kind: "FreeForm" | "Folder", title: string): Promise<string | null> => {
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, kind, ...(currentFolderId ? { parentPageId: currentFolderId } : {}) }),
      });
      if (!res.ok) return null;
      return ((await res.json()) as { id: string }).id;
    },
    [projectId, currentFolderId],
  );

  const createDoc = useCallback(async () => {
    const name = await dialog.prompt({
      title: "New document",
      label: "Name",
      defaultValue: "Untitled",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const id = await createPage("FreeForm", name.trim());
    if (id) navigate(`/documents/${id}`);
    else toast.error("Couldn't create the document");
  }, [dialog, createPage, navigate, toast]);

  const createFolder = useCallback(async () => {
    const name = await dialog.prompt({
      title: "New folder",
      label: "Folder name",
      defaultValue: "New folder",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const id = await createPage("Folder", name.trim());
    if (id) {
      toast.success("Folder created");
      revalidate();
    } else {
      toast.error("Couldn't create the folder");
    }
  }, [dialog, createPage, revalidate, toast]);

  function deleteDriveItemRequest(item: DriveItem): Promise<Response> {
    const endpoint = item.type === "file" ? `/api/files/${item.id}` : `/api/documents/${item.id}`;
    return fetch(endpoint, { method: "DELETE", credentials: "include" });
  }

  const onBulkDelete = useCallback(
    async (items: DriveItem[]) => {
      if (items.length === 0) return;
      const ok = await dialog.confirm({
        title: `Delete ${items.length} item${items.length === 1 ? "" : "s"}?`,
        description: "Folders must be empty first.",
        tone: "destructive",
        confirmLabel: "Delete",
      });
      if (!ok) return;
      await runTrash({ items, deleteOne: deleteDriveItemRequest, hiding: pendingHidden, history, toast, revalidate });
    },
    [dialog, toast, revalidate, pendingHidden, history],
  );

  const onBulkMove = useCallback(
    async (items: DriveItem[]) => {
      const movable = items.filter((i) => i.type === "doc" || i.type === "folder" || i.type === "file");
      if (movable.length === 0) return;
      const dest = await pickMoveDestination(movable[0], `Move ${itemCount(movable.length)}`);
      if (dest) await moveItems(movable, dest.folderId);
    },
    [pickMoveDestination, moveItems],
  );

  const filterControl = (
    <div data-testid="drive-filter">
      <Select<ProjectDriveTypeFilter>
        value={typeFilter}
        onChange={setTypeFilter}
        ariaLabel="Filter by type"
        align="right"
        options={PROJECT_TYPE_FILTERS.map((f) => ({ value: f.value, label: f.label, icon: f.icon }))}
        buttonClassName={cn(filterPillClass(), "w-full sm:w-40")}
      />
    </div>
  );

  // The same New control the unified Drive wears — this tab is the same
  // browser, and a different button here read as a different app's control
  // sitting in Drive's toolbar. Without edit rights it greys out in place
  // rather than leaving a hole for the controls beside it to slide into.
  const newMenu = !canEdit ? (
    <button
      type="button"
      disabled
      data-testid={`drive-new-menu-${scopeId}-disabled`}
      title="You don't have edit access to this project"
      className={cn(DRIVE_TOOLBAR_BTN, "cursor-not-allowed opacity-40")}
    >
      <Plus className="h-[18px] w-[18px]" strokeWidth={1.5} /> New
      <ChevronDown className="w-3.5 h-3.5 opacity-80" />
    </button>
  ) : (
    <Menu
      align="right"
      ariaLabel="New in this project"
      trigger={
        <button
          type="button"
          data-testid={`drive-new-menu-${scopeId}`}
          className={DRIVE_TOOLBAR_BTN}
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={1.5} /> New
          <ChevronDown className="w-3.5 h-3.5 opacity-80" />
        </button>
      }
    >
      <Menu.Item icon={<FileText className="w-3.5 h-3.5" />} onSelect={() => void createDoc()}>
        <span data-testid={`drive-new-doc-${scopeId}`}>New document</span>
      </Menu.Item>
      <Menu.Item icon={<FolderPlus className="w-3.5 h-3.5" />} onSelect={() => void createFolder()}>
        <span data-testid={`drive-new-folder-${scopeId}`}>New folder</span>
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item icon={<Upload className="w-3.5 h-3.5" />} disabled={uploading} onSelect={() => inputRef.current?.click()}>
        <span data-testid={`drive-new-upload-${scopeId}`}>{uploading ? "Uploading…" : "Upload files"}</span>
      </Menu.Item>
    </Menu>
  );

  return (
    <DriveHistoryContext.Provider value={history}>
      {uploadError && (
        <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-sm text-destructive">
          {uploadError}
        </div>
      )}
      <DriveBrowser
        scopes={visibleScopes}
        currentScopeId={scopeId}
        currentFolderId={currentFolderId}
        typeFilter={typeFilter}
        search={search}
        onSearchChange={setSearch}
        onNavigate={onNavigate}
        onOpenItem={onOpenItem}
        onOpenBeside={onOpenBeside}
        onMove={onMove}
        getScopeActions={getScopeActions}
        onToggleFavorite={onToggleFavorite}
        onBulkDelete={canEdit ? onBulkDelete : undefined}
        onBulkMove={canEdit ? onBulkMove : undefined}
        onUploadFiles={
          canEdit
            ? (files, opts) =>
                void uploadFiles(files, { folderPageId: opts?.folderId, skippedFolders: opts?.skippedFolders })
            : undefined
        }
        filterControl={filterControl}
        newMenu={newMenu}
        embeddedScopeId={scopeId}
        onTogglePartnerVisible={canEdit ? togglePagePartnerVisible : undefined}
        hasActivePartner={hasActivePartner}
        receiverViewer={receiverViewer}
      />
      <DriveUploadInput
        inputRef={inputRef}
        onChange={handleFileChange}
        testId={`drive-upload-input-${scopeId}`}
      />
      {movePicker && (
        <FolderPicker
          open
          heading={movePicker.heading}
          drives={movePicker.drives}
          folders={movePicker.folders}
          disabledFolderIds={movePicker.disabledFolderIds}
          disabledDest={movePicker.disabledDest}
          initial={movePicker.initial}
          onClose={() => resolveMovePicker(null)}
          onConfirm={(dest) => resolveMovePicker(dest)}
        />
      )}
    </DriveHistoryContext.Provider>
  );
}
