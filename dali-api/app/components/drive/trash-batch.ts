import type { DriveItem } from "~/lib/drive.server";
import { ACTION_TOAST_MS, restoredToast, trashedToast } from "~/components/drive/action-toast";
import { driveErrorFrom } from "~/components/drive/move-item";
import type { MoveBatchToast } from "~/components/drive/move-batch";
import type { PendingHidden } from "~/components/drive/pending-hidden";
import type { DriveHistory } from "~/components/drive/use-drive-history";

type Trashable = Pick<DriveItem, "id" | "type" | "title">;

/** The `type` the trash endpoint files an item under. */
export function trashTypeOf(item: Pick<DriveItem, "type">): "form" | "file" | "folder" | "doc" {
  if (item.type === "form" || item.type === "file" || item.type === "folder") return item.type;
  return "doc";
}

export function restoreFromTrashRequest(item: Trashable): Promise<Response> {
  const fd = new FormData();
  fd.set("intent", "restore");
  fd.set("type", trashTypeOf(item));
  fd.set("id", item.id);
  return fetch("/api/drive/trash", { method: "POST", body: fd, credentials: "include" });
}

async function applyAll<T>(items: T[], step: (item: T) => Promise<boolean>, failure: string) {
  let failed = 0;
  for (const item of items) if (!(await step(item))) failed++;
  if (failed > 0) throw new Error(failure);
}

/**
 * Trash `items` one after another (the confirm, if any, is already behind us):
 * hide their rows, delete, revalidate once, then say what happened. Everything
 * trashed can be put back from the toast or with Cmd+Z.
 */
export async function runTrash<T extends Trashable>({
  items,
  deleteOne,
  restoreOne = async (item) => (await restoreFromTrashRequest(item)).ok,
  hiding,
  history,
  toast,
  revalidate,
}: {
  items: T[];
  deleteOne: (item: T) => Promise<Response>;
  restoreOne?: (item: T) => Promise<boolean>;
  hiding: Pick<PendingHidden, "hide">;
  history: Pick<DriveHistory, "record" | "undoEntry">;
  toast: MoveBatchToast & { success: MoveBatchToast["info"] };
  revalidate: () => void;
}): Promise<void> {
  const pending = hiding.hide(items.map((i) => i.id));
  const trashed: T[] = [];
  const failed: T[] = [];
  let reason: string | undefined;
  for (const item of items) {
    const res = await deleteOne(item).catch(() => null);
    if (res?.ok) trashed.push(item);
    else {
      failed.push(item);
      reason ??= res ? await driveErrorFrom(res) : undefined;
    }
  }
  pending.settle(failed.map((i) => i.id));
  revalidate();

  if (failed.length > 0) {
    toast.error(failed.length === 1 && items.length === 1 ? (reason ?? "Couldn't delete") : `${failed.length} item${failed.length === 1 ? "" : "s"} couldn't be deleted`);
  }
  if (trashed.length === 0) return;

  const message = trashedToast(trashed);
  const titles = trashed.map((i) => i.title);
  const entry = history.record({
    label: "Delete",
    undo: () => applyAll(trashed, restoreOne, "Couldn't restore everything"),
    redo: () => applyAll(trashed, async (item) => (await deleteOne(item).catch(() => null))?.ok === true, "Couldn't move everything to Trash again"),
    undoneMessage: restoredToast(titles),
    redoneMessage: trashedToast(trashed),
  });
  toast.success(message, {
    duration: ACTION_TOAST_MS,
    actions: [{ label: "Undo", onClick: () => void history.undoEntry(entry) }],
  });
}
