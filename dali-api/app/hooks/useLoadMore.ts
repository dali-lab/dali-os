import { useRef, useState } from "react";
import type { LoadMoreProps } from "~/components/ui/Pager";

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export async function fetchCursorPage<T>(url: string): Promise<CursorPage<T>> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Load more failed (${res.status})`);
  return (await res.json()) as CursorPage<T>;
}

interface Options<T> {
  items: T[];
  nextCursor: string | null;
  fetchPage: (cursor: string) => Promise<CursorPage<T>>;
  idOf: (item: T) => string;
  // Change this when a filter changes, so older pages from the last filter drop.
  resetKey?: string;
  total?: number;
}

interface Extra<T> {
  key: string;
  items: T[];
  // undefined until the first page load, so a revalidated loader cursor wins.
  cursor: string | null | undefined;
}

export function useLoadMore<T>({
  items,
  nextCursor,
  fetchPage,
  idOf,
  resetKey = "",
  total,
}: Options<T>): { items: T[]; pager: LoadMoreProps } {
  const [extra, setExtra] = useState<Extra<T>>({ key: resetKey, items: [], cursor: undefined });
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const liveKey = useRef(resetKey);
  liveKey.current = resetKey;

  if (extra.key !== resetKey) {
    setExtra({ key: resetKey, items: [], cursor: undefined });
    setFailed(false);
  }
  const current = extra.key === resetKey ? extra : { items: [] as T[], cursor: undefined };
  const cursor = current.cursor === undefined ? nextCursor : current.cursor;

  const seen = new Set(items.map(idOf));
  const merged = [...items, ...current.items.filter((item) => !seen.has(idOf(item)))];

  const onLoadMore = async () => {
    if (!cursor || loading) return;
    const requestKey = resetKey;
    setLoading(true);
    setFailed(false);
    try {
      const page = await fetchPage(cursor);
      if (liveKey.current !== requestKey) return;
      setExtra((prev) => ({
        key: requestKey,
        items: [...prev.items, ...page.items],
        cursor: page.nextCursor,
      }));
    } catch {
      if (liveKey.current === requestKey) setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return {
    items: merged,
    pager: { hasMore: !!cursor, loading, failed, shown: merged.length, total, onLoadMore },
  };
}
