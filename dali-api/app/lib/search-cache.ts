export type SearchHit<T> = { items: T[]; exact: boolean; fetchedAt: number };

export type SearchCache<T> = {
  peek(query: string): SearchHit<T> | null;
  load(query: string): Promise<T[] | null>;
  loadDebounced(query: string): Promise<T[] | null>;
  clear(): void;
};

const MAX_ENTRIES = 50;
const DEBOUNCE_MS = 120;
const FRESH_MS = 2000;

const keyOf = (query: string) => query.trim().toLowerCase();

/**
 * Session-only, in-memory typeahead cache keyed by query. `fetch` resolves
 * null on failure so an outage is never cached as "no results".
 */
export function createSearchCache<T>(opts: {
  fetch: (query: string) => Promise<T[] | null>;
  /** Omit to serve exact hits only. */
  matches?: (item: T, query: string) => boolean;
  maxEntries?: number;
  debounceMs?: number;
}): SearchCache<T> {
  const { maxEntries = MAX_ENTRIES, debounceMs = DEBOUNCE_MS } = opts;
  const entries = new Map<string, { items: T[]; fetchedAt: number }>();
  const inFlight = new Map<string, Promise<T[] | null>>();
  let pending: { timer: ReturnType<typeof setTimeout>; settle: (items: null) => void } | null = null;

  function peek(query: string): SearchHit<T> | null {
    const key = keyOf(query);
    const exact = entries.get(key);
    if (exact) return { ...exact, exact: true };
    const { matches } = opts;
    if (!matches) return null;
    for (let len = key.length - 1; len >= 0; len--) {
      const prefix = entries.get(key.slice(0, len));
      if (prefix) {
        return {
          items: prefix.items.filter((item) => matches(item, key)),
          exact: false,
          fetchedAt: prefix.fetchedAt,
        };
      }
    }
    return null;
  }

  function load(query: string): Promise<T[] | null> {
    const key = keyOf(query);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const request = opts
      .fetch(key)
      .then((items) => {
        if (items) {
          entries.delete(key);
          entries.set(key, { items, fetchedAt: Date.now() });
          if (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
        }
        return items;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  }

  function loadDebounced(query: string): Promise<T[] | null> {
    pending?.settle(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending = null;
        resolve(load(query));
      }, debounceMs);
      pending = { timer, settle: (value) => (clearTimeout(timer), resolve(value)) };
    });
  }

  return {
    peek,
    load,
    loadDebounced,
    clear() {
      entries.clear();
      inFlight.clear();
      pending?.settle(null);
      pending = null;
    },
  };
}

const sameItems = <T>(a: T[], b: T[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Cached results now, network refresh behind them. A hit is returned at once
 * (an exact one, or the longest cached prefix filtered client-side); `onFresh`
 * fires only if the refresh differs from what was returned. With no hit the
 * debounced request is awaited.
 */
export async function searchWithCache<T>(
  cache: SearchCache<T>,
  query: string,
  onFresh?: () => void,
): Promise<T[]> {
  const hit = cache.peek(query);
  if (hit?.exact && Date.now() - hit.fetchedAt < FRESH_MS) return hit.items;
  const request = cache.loadDebounced(query);
  if (hit) {
    void request.then((fresh) => {
      if (fresh && !sameItems(fresh, hit.items)) onFresh?.();
    });
    return hit.items;
  }
  return (await request) ?? cache.peek(query)?.items ?? [];
}
