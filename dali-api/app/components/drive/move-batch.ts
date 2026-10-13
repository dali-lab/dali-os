import type { ReactNode } from "react";
import { ACTION_TOAST_MS, movedToast } from "~/components/drive/action-toast";
import type { PendingHidden } from "~/components/drive/pending-hidden";
import type { DriveHistory } from "~/components/drive/use-drive-history";

/** "1 item" / "4 items" — the count every move summary is phrased around. */
export function itemCount(n: number): string {
  return `${n} item${n === 1 ? "" : "s"}`;
}

/** The slice of `useToast()` this needs, so the helper stays testable. */
export type MoveBatchToast = {
  info: (message: ReactNode, opts?: { duration?: number; actions?: Array<{ label: string; onClick: () => void }> }) => void;
  error: (message: ReactNode, opts?: { duration?: number }) => void;
};

export type Landed<T> = { item: T; folderId: string | null };

export type MoveReport<T extends { title: string }> = {
  /** The items that landed, each with the folder it came from. */
  landed: Landed<T>[];
  /** How many were attempted. */
  total: number;
  /** The full path moved to; null when only the item count is known. */
  destination: string | null;
  /** Send one landed item to the destination again (redo). */
  forward: (landed: Landed<T>) => Promise<boolean>;
  /**
   * Put one landed item back where it came from. Null when the move is
   * one-way: a move out of My Drive can't be reversed, since the move endpoint
   * refuses a Member destination.
   */
  back: ((landed: Landed<T>) => Promise<boolean>) | null;
  /** The server's reason, when nothing landed and it gave one. */
  failure?: string;
};

async function applyAll<T>(landed: Landed<T>[], step: (l: Landed<T>) => Promise<boolean>, failure: string) {
  let failed = 0;
  for (const l of landed) if (!(await step(l))) failed++;
  if (failed > 0) throw new Error(failure);
}

/**
 * Report a finished batch of moves: revalidate once, then show one toast that
 * names what moved and where, with an Undo that goes through the Drive's
 * history so Cmd+Z and the toast always agree.
 *
 * A partial failure reports without an Undo. Reversing only the half that
 * landed would leave the selection split across two places, which is harder to
 * reason about than the state the user can already see.
 */
export function reportMoveBatch<T extends { title: string }>(
  { toast, history, revalidate }: { toast: MoveBatchToast; history: Pick<DriveHistory, "record" | "undoEntry">; revalidate: () => void },
  { landed, total, destination, forward, back, failure }: MoveReport<T>,
): void {
  revalidate();
  if (landed.length === 0) {
    toast.error(failure ?? (total === 1 ? "Couldn't move that item" : `Couldn't move ${itemCount(total)}`));
    return;
  }
  const message = movedToast({ titles: landed.map((l) => l.item.title), attempted: total, destination });
  if (!back || landed.length < total) {
    toast.info(message, { duration: ACTION_TOAST_MS });
    return;
  }
  const entry = history.record({
    label: "Move",
    undo: () => applyAll(landed, back, "Couldn't put everything back"),
    redo: () => applyAll(landed, forward, "Couldn't move everything again"),
  });
  toast.info(message, {
    duration: ACTION_TOAST_MS,
    actions: [{ label: "Undo", onClick: () => void history.undoEntry(entry) }],
  });
}

/**
 * Run `move` over every item, keeping each one's origin so the batch can be
 * reversed as a unit. Returns the ones that landed, in order.
 *
 * Sequential on purpose: these all hit the same rows' sibling ordering, and a
 * parallel burst would race the position rebuild the move endpoint does.
 */
export async function runMoveBatch<T extends { parentFolderId: string | null }>(
  items: T[],
  move: (item: T) => Promise<boolean>,
): Promise<Landed<T>[]> {
  const landed: Landed<T>[] = [];
  for (const item of items) {
    const origin = item.parentFolderId;
    if (await move(item)) landed.push({ item, folderId: origin });
  }
  return landed;
}

/**
 * `runMoveBatch` with the rows hidden from the listing from the start, so they
 * leave at once instead of after the loader re-runs. Items that fail come back.
 */
export async function runHiddenMoveBatch<T extends { id: string; parentFolderId: string | null }>(
  items: T[],
  move: (item: T) => Promise<boolean>,
  hiding: Pick<PendingHidden, "hide">,
): Promise<Landed<T>[]> {
  const pending = hiding.hide(items.map((i) => i.id));
  let landed: Landed<T>[];
  try {
    landed = await runMoveBatch(items, move);
  } catch (err) {
    pending.settle(items.map((i) => i.id));
    throw err;
  }
  const landedIds = new Set(landed.map((l) => l.item.id));
  pending.settle(items.filter((i) => !landedIds.has(i.id)).map((i) => i.id));
  return landed;
}
