import type { ReactNode } from "react";

// How a Drive move reports itself when it covers more than one item.
//
// Both move surfaces — the hub's bulk bar / cross-drive picker and the
// project-embedded Drive — used to loop a single-item move and let each
// iteration speak for itself. Moving twelve files stacked twelve toasts (the
// toast viewport has no cap), fired twelve full tree revalidations, and left
// twelve separate Undos, each reversing one file. Undoing the move meant
// twelve clicks before the first toast expired.
//
// Google Drive's model, and what this module encodes: one snackbar naming the
// count and the destination, one Undo for the whole batch.

/** "1 item" / "4 items" — the count every move summary is phrased around. */
export function itemCount(n: number): string {
  return `${n} item${n === 1 ? "" : "s"}`;
}

/** The slice of `useToast()` this needs, so the helper stays testable. */
export type MoveBatchToast = {
  info: (message: ReactNode, opts?: { duration?: number }) => void;
  error: (message: ReactNode, opts?: { duration?: number }) => void;
};

export type MoveBatchResult = {
  /** How many items actually landed. */
  moved: number;
  /** How many were attempted. */
  total: number;
  /** The sentence shown when at least one landed, e.g. "Moved 4 items to Design". */
  summary: string;
  /**
   * Reverses every item that landed. Null when there is nothing to offer —
   * a move out of My Drive is one-way, since the move endpoint refuses a
   * Member destination and an Undo could only fail.
   */
  undo: (() => Promise<void>) | null;
};

/**
 * Report a finished batch of moves: revalidate once, then show one toast.
 *
 * A partial failure reports without an Undo. Reversing only the half that
 * landed would leave the selection split across two places, which is harder to
 * reason about than the state the user can already see.
 */
export function reportMoveBatch(
  toast: MoveBatchToast,
  revalidate: () => void,
  { moved, total, summary, undo }: MoveBatchResult,
): void {
  revalidate();
  if (moved === 0) {
    toast.error(total === 1 ? "Couldn't move that item" : `Couldn't move ${itemCount(total)}`);
    return;
  }
  if (!undo || moved < total) {
    toast.info(summary, { duration: 6000 });
    return;
  }
  toast.info(
    <span className="flex items-center gap-2">
      {summary}
      <button
        type="button"
        className="underline font-medium hover:no-underline"
        onClick={() => void undo().then(revalidate)}
      >
        Undo
      </button>
    </span>,
    { duration: 6000 },
  );
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
): Promise<{ item: T; folderId: string | null }[]> {
  const landed: { item: T; folderId: string | null }[] = [];
  for (const item of items) {
    const origin = item.parentFolderId;
    if (await move(item)) landed.push({ item, folderId: origin });
  }
  return landed;
}
