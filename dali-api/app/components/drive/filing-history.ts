import type { PagePlace, ServerDest } from "~/components/drive/file-in";
import {
  createShortcutRequest,
  deleteShortcutRequest,
  movePageToPlaceRequest,
  placePageRequest,
} from "~/components/drive/shortcut-api";
import type { UndoEntry } from "~/components/drive/undo-stack";

/** What "File in…" and "Add shortcut to…" report once they have written, so the host can reverse it. */
export type FileInResult = {
  /** Where the page lived before; null when the picker never loaded it (a plain shortcut doesn't need it). */
  previousPrimary: PagePlace | null;
  createdShortcutIds: string[];
};

async function removeShortcuts(ids: string[]) {
  for (const id of ids) {
    const res = await deleteShortcutRequest(id);
    // A shortcut that is already gone is the state undo wants.
    if (!res.ok && res.status !== 404) throw new Error("Couldn't remove the shortcuts");
  }
}

/**
 * Undo puts the page back where it was and removes the shortcuts the filing
 * created; redo files it again. Shortcuts that already existed are not in the
 * request, so they are never touched.
 */
export function filingEntry({
  pageId,
  previousPrimary,
  primaryChanged,
  destinations,
  primaryIndex,
  createdShortcutIds,
}: {
  pageId: string;
  previousPrimary: PagePlace;
  primaryChanged: boolean;
  destinations: ServerDest[];
  primaryIndex: number;
  createdShortcutIds: string[];
}): UndoEntry {
  let created = createdShortcutIds;
  return {
    label: "Filing",
    undo: async () => {
      if (primaryChanged) {
        const moved = await movePageToPlaceRequest(pageId, previousPrimary);
        if (!moved.ok) throw new Error(moved.error);
      }
      await removeShortcuts(created);
      created = [];
    },
    redo: async () => {
      const placed = await placePageRequest(pageId, destinations, primaryIndex);
      if (!placed.ok) throw new Error(placed.error);
      created = placed.shortcutIds ?? [];
    },
  };
}

/** Undo removes the shortcut; redo adds it again. */
export function shortcutEntry({
  pageId,
  dest,
  shortcutId,
}: {
  pageId: string;
  dest: ServerDest;
  shortcutId: string;
}): UndoEntry {
  let current = shortcutId;
  return {
    label: "Shortcut",
    undo: () => removeShortcuts([current]),
    redo: async () => {
      const created = await createShortcutRequest(pageId, dest);
      if (!created.ok) throw new Error(created.error);
      current = created.shortcutId;
    },
    undoneMessage: "Shortcut removed",
    redoneMessage: "Shortcut added again",
  };
}
