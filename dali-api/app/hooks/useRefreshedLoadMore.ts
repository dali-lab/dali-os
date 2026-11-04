import { useEffect, useRef, useState } from "react";
import type { LoadMoreProps } from "~/components/ui/Pager";
import { useLoadMore, type CursorPage } from "~/hooks/useLoadMore";

interface Options<T> {
  items: T[];
  nextCursor: string | null;
  fetchPage: (cursor: string) => Promise<CursorPage<T>>;
  // Returns the current version of each id; ids that no longer exist are omitted.
  fetchByIds: (ids: string[]) => Promise<T[]>;
}

type Feedable = { id: string; createdAt: string };

const newestFirst = (a: Feedable, b: Feedable) =>
  a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1;

// useLoadMore keeps older pages across loader revalidation, but the loader only
// refreshes the first page. When it revalidates (after a vote, comment, delete
// or new post), re-read everything shown beyond the first page so those rows
// stay current, including rows the first page just pushed off its end.
export function useRefreshedLoadMore<T extends Feedable>({
  items,
  nextCursor,
  fetchPage,
  fetchByIds,
}: Options<T>): { items: T[]; pager: LoadMoreProps } {
  const { items: merged, pager } = useLoadMore<T>({ items, nextCursor, fetchPage, idOf: (p) => p.id });
  const [overrides, setOverrides] = useState<Map<string, T | null>>(new Map());
  const lastShown = useRef<T[]>([]);
  const seq = useRef(0);
  const mounted = useRef(false);
  const fetchByIdsRef = useRef(fetchByIds);
  fetchByIdsRef.current = fetchByIds;

  const firstIds = new Set(items.map((p) => p.id));
  const byId = new Map(merged.map((p) => [p.id, p]));
  for (const [id, override] of overrides) {
    if (firstIds.has(id)) continue;
    if (override === null) byId.delete(id);
    else byId.set(id, override);
  }
  const shown = [...byId.values()].sort(newestFirst);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const ids = lastShown.current.map((p) => p.id).filter((id) => !firstIds.has(id));
    if (ids.length === 0) return;
    const mine = ++seq.current;
    fetchByIdsRef
      .current(ids)
      .then((found) => {
        if (mine !== seq.current) return;
        const current = new Map(found.map((p) => [p.id, p]));
        setOverrides((prev) => {
          const next = new Map(prev);
          for (const id of ids) next.set(id, current.get(id) ?? null);
          return next;
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    lastShown.current = shown;
  });

  return { items: shown, pager: { ...pager, shown: shown.length } };
}
