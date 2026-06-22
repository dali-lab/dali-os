import { useCallback, useEffect, useRef, useState } from "react";

export type OptimisticBoardMove<TItem> = {
  items: TItem[];
  /**
   * Optimistically apply `patch` to local items, POST, and roll back on failure.
   * `persist` runs after the optimistic patch is applied so callers can derive
   * the request body from the already-patched state if they need to.
   */
  move: (patch: (items: TItem[]) => TItem[], persist: () => Promise<void>) => void;
  /** True while a save is in flight — callers gate revalidation adoption on this. */
  isSaving: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  /** Replace local items outright (e.g. a create flow appending a card). */
  setItems: (updater: (items: TItem[]) => TItem[]) => void;
};

export type UseOptimisticBoardMoveOptions = {
  /**
   * Adopt fresh `serverItems` into local state when they change and no save is
   * in flight. True for boards that revalidate / receive live pushes (so other
   * people's edits appear). False for boards that solely own their state and
   * never want a loader revalidation to clobber local optimistic items (e.g. a
   * TaskBoard whose parent route revalidates on unrelated edits). Default true.
   */
  adoptServerItems?: boolean;
};

// Internalizes the optimistic-move pattern duplicated across every board:
// snapshot `prev`, apply the patch, POST, restore `prev` + surface an error on
// throw. A `pendingSaves` ref counts in-flight saves so a revalidation or live
// push (SSE / poll) can't adopt stale `serverItems` and clobber an unsaved
// optimistic move mid-flight. Server data is adopted only once every save has
// settled — including server data that arrived *during* a save (the common
// "revalidate-on-success" sequence), which is held in a ref and adopted when
// the last save drains.
export function useOptimisticBoardMove<TItem>(
  serverItems: TItem[],
  options: UseOptimisticBoardMoveOptions = {},
): OptimisticBoardMove<TItem> {
  const { adoptServerItems = true } = options;

  const [items, setItemsState] = useState<TItem[]>(serverItems);
  const [error, setError] = useState<string | null>(null);
  const [savingCount, setSavingCount] = useState(0);

  // Number of saves currently in flight. While > 0 we hold off adopting server
  // data so a remote push can't revert our own unsaved optimistic move.
  const pendingSaves = useRef(0);
  // The most recent server data, even if it arrived mid-save. When the last
  // save drains we adopt this so a revalidation that resolved before
  // `pendingSaves` was decremented is never dropped.
  const latestServerItems = useRef(serverItems);
  latestServerItems.current = serverItems;

  // Adopt fresh server data only when no save is in flight. Keyed off the prop's
  // identity: React Router hands back a new array each loader run, so this fires
  // exactly when server data actually changes.
  useEffect(() => {
    if (!adoptServerItems) return;
    if (pendingSaves.current > 0) return;
    setItemsState(serverItems);
  }, [serverItems, adoptServerItems]);

  const move = useCallback(
    (patch: (items: TItem[]) => TItem[], persist: () => Promise<void>) => {
      let prev: TItem[] = [];
      setItemsState((cur) => {
        prev = cur;
        return patch(cur);
      });
      setError(null);

      pendingSaves.current += 1;
      setSavingCount((c) => c + 1);
      void persist()
        .catch((err) => {
          setItemsState(prev);
          setError(err instanceof Error ? err.message : "Failed to save");
        })
        .finally(() => {
          pendingSaves.current = Math.max(0, pendingSaves.current - 1);
          setSavingCount((c) => Math.max(0, c - 1));
          // The last save drained: adopt the latest server data, including data
          // that arrived while we were holding off (the revalidate-on-success
          // sequence), so it's reflected instead of silently dropped.
          if (adoptServerItems && pendingSaves.current === 0) {
            setItemsState(latestServerItems.current);
          }
        });
    },
    [adoptServerItems],
  );

  const setItems = useCallback((updater: (items: TItem[]) => TItem[]) => {
    setItemsState(updater);
  }, []);

  return {
    items,
    move,
    isSaving: savingCount > 0,
    error,
    setError,
    setItems,
  };
}
