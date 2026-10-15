import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Safety net: a request whose revalidation never reports back stops hiding its items after this long. */
const SETTLE_TIMEOUT_MS = 15_000;

const NONE: ReadonlySet<string> = new Set();

/** `scopes` without the items in `hidden`; the same array when there is nothing to hide, so memo consumers stay put. */
export function withoutHidden<S extends { items: Array<{ id: string }> }>(
  scopes: S[],
  hidden: ReadonlySet<string>,
): S[] {
  if (hidden.size === 0) return scopes;
  return scopes.map((scope) => (scope.items.some((it) => hidden.has(it.id)) ? { ...scope, items: scope.items.filter((it) => !hidden.has(it.id)) } : scope));
}

export type PendingHide = {
  /** The request finished. Ids in `failed` come back at once; the rest stay hidden until the revalidation lands. Call `revalidate` right after. */
  settle: (failed?: string[]) => void;
};

export type PendingHidden = {
  ids: ReadonlySet<string>;
  /** Hide `ids` now, before the request that moves or trashes them has answered. */
  hide: (ids: string[]) => PendingHide;
};

/**
 * Items hidden while their move or trash request is in flight, so a row leaves
 * the listing the moment the user acts rather than after the loader re-runs.
 * They stay hidden after the request until the revalidation that follows it
 * goes idle (or fresh loader data arrives), so the old row never flashes back
 * in between.
 */
export function usePendingHidden(revalidationState: "idle" | "loading", loaderData: unknown): PendingHidden {
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE);
  const waiting = useRef<Array<{ ids: string[]; sawLoading: boolean }>>([]);
  const stateRef = useRef(revalidationState);
  stateRef.current = revalidationState;

  const release = useCallback((released: string[]) => {
    if (released.length === 0) return;
    setIds((prev) => {
      if (!released.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of released) next.delete(id);
      return next.size === 0 ? NONE : next;
    });
  }, []);

  const hide = useCallback(
    (hidden: string[]): PendingHide => {
      setIds((prev) => new Set([...prev, ...hidden]));
      return {
        settle: (failed = []) => {
          release(failed);
          const kept = hidden.filter((id) => !failed.includes(id));
          if (kept.length === 0) return;
          const slot = { ids: kept, sawLoading: stateRef.current === "loading" };
          waiting.current.push(slot);
          setTimeout(() => {
            if (!waiting.current.includes(slot)) return;
            waiting.current = waiting.current.filter((w) => w !== slot);
            release(slot.ids);
          }, SETTLE_TIMEOUT_MS);
        },
      };
    },
    [release],
  );

  useEffect(() => {
    if (revalidationState === "loading") {
      for (const slot of waiting.current) slot.sawLoading = true;
      return;
    }
    const done = waiting.current.filter((slot) => slot.sawLoading);
    if (done.length === 0) return;
    waiting.current = waiting.current.filter((slot) => !slot.sawLoading);
    release(done.flatMap((slot) => slot.ids));
  }, [revalidationState, release]);

  const seenData = useRef(loaderData);
  useEffect(() => {
    if (seenData.current === loaderData) return;
    seenData.current = loaderData;
    const done = waiting.current;
    if (done.length === 0) return;
    waiting.current = [];
    release(done.flatMap((slot) => slot.ids));
  }, [loaderData, release]);

  return useMemo(() => ({ ids, hide }), [ids, hide]);
}
