import { FileText, ClipboardList, Paperclip, Folder, Trash2, RotateCcw, X } from "lucide-react";
import { useState, useEffect } from "react";
import { DriveBrowser } from "~/components/drive/DriveBrowser";
import { FolderPicker } from "~/components/drive/FolderPicker";
import { LocationLink } from "~/components/drive/LocationLink";
import { locateFolder, type LocatableScope } from "~/components/drive/location";
import { restoredToast } from "~/components/drive/action-toast";
import { restoreFromTrashRequest } from "~/components/drive/trash-batch";
import { useDriveFileUpload } from "~/components/drive/useDriveFileUpload";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { Modal } from "~/components/Modal";
import { LoadMore } from "~/components/ui/Pager";
import { fetchCursorPage, useLoadMore } from "~/hooks/useLoadMore";
import { modalCardClass } from "~/components/os-chrome";


export const trashKey = (item: { type: string; id: string }) => `${item.type}:${item.id}`;

export type TrashItem = {
  id: string;
  type: "doc" | "folder" | "file" | "form";
  title: string;
  parentFolderId: string | null;
  archivedAt: string;
};

export function TrashPanel({
  scopes,
  onNavigate,
  onClose,
  onRevalidate,
  dialog,
  toast,
}: {
  scopes: LocatableScope[];
  onNavigate: (scopeId: string, folderId: string | null) => void;
  onClose: () => void;
  onRevalidate: () => void;
  dialog: ReturnType<typeof useDialog>;
  toast: ReturnType<typeof useToast>;
}) {
  const [first, setFirst] = useState<{ items: TrashItem[]; nextCursor: string | null }>({ items: [], nextCursor: null });
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchCursorPage<TrashItem>("/api/drive/trash")
      .then((page) => live && setFirst(page))
      .catch((err) => live && setError(err instanceof Error ? err.message : "Failed to load trash"))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  const { items: loaded, pager } = useLoadMore<TrashItem>({
    items: first.items,
    nextCursor: first.nextCursor,
    fetchPage: (cursor) => fetchCursorPage<TrashItem>(`/api/drive/trash?cursor=${encodeURIComponent(cursor)}`),
    idOf: trashKey,
  });
  const items = loaded.filter((item) => !removed.has(trashKey(item)));

  function dropLocally(item: TrashItem) {
    setRemoved((prev) => new Set(prev).add(trashKey(item)));
  }

  async function restore(item: TrashItem) {
    const res = await restoreFromTrashRequest(item);
    if (res.ok) {
      toast.success(restoredToast([item.title]));
      dropLocally(item);
      onRevalidate();
    } else {
      toast.error("Couldn't restore");
    }
  }

  async function purge(item: TrashItem) {
    const confirmed = await dialog.confirm({
      title: `Delete "${item.title || "Untitled"}" permanently?`,
      description: "This can't be undone.",
      tone: "destructive",
      confirmLabel: "Delete permanently",
    });
    if (!confirmed) return;
    const fd = new FormData();
    fd.set("intent", "purge");
    fd.set("type", item.type);
    fd.set("id", item.id);
    const res = await fetch("/api/drive/trash", { method: "POST", body: fd, credentials: "include" });
    if (res.ok) {
      toast.success("Deleted permanently");
      dropLocally(item);
      onRevalidate();
    } else {
      toast.error("Couldn't delete");
    }
  }

  function trashItemIcon(type: TrashItem["type"]) {
    switch (type) {
      case "folder": return <Folder className="w-4 h-4 text-os-accent/80 shrink-0" />;
      case "form": return <ClipboardList className="w-4 h-4 text-muted-foreground shrink-0" />;
      case "file": return <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />;
      default: return <FileText className="w-4 h-4 text-muted-foreground shrink-0" />;
    }
  }

  const titleId = "trash-panel-title";

  return (
    <Modal open onClose={onClose} labelledBy={titleId}
      containerClassName={modalCardClass("max-w-2xl max-h-[80vh] flex flex-col")}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 id={titleId} className="text-base font-semibold text-foreground flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-muted-foreground" /> Trash
        </h2>
        <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      {loading && <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>}
      {error && <p className="text-sm text-destructive py-2">{error}</p>}
      {!loading && !error && items.length === 0 && !pager.hasMore && (
        <p className="text-sm text-muted-foreground italic py-8 text-center">Trash is empty.</p>
      )}
      {!loading && !error && (items.length > 0 || pager.hasMore) && (
        <div className="flex flex-col gap-0.5 overflow-y-auto flex-1 -mx-1 px-1">
          {items.map((item) => (
            <div
              key={`${item.type}:${item.id}`}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted/40 group"
            >
              {trashItemIcon(item.type)}
              <span className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground truncate block">{item.title || "Untitled"}</span>
                <span className="text-xs text-muted-foreground">
                  Deleted {new Date(item.archivedAt).toLocaleDateString()}
                </span>
              </span>
              <span className="flex w-44 shrink-0 min-w-0">
                <LocationLink location={locateFolder(scopes, item.parentFolderId)} onNavigate={onNavigate} />
              </span>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => void restore(item)}
                  title="Restore"
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Restore
                </button>
                <button
                  type="button"
                  onClick={() => void purge(item)}
                  title="Delete permanently"
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>
          ))}
          <LoadMore {...pager} />
        </div>
      )}
    </Modal>
  );
}
