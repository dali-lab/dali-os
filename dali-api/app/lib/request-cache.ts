// Per-request memoization. A single incoming Request is handled once, but React
// Router runs the shell (layout.tsx) and the matched route loader concurrently
// for the same navigation — so shared work (the auth session lookup, the
// Favorites/Recents access-checked read) was being derived twice per page load.
//
// Keying a WeakMap on the Request object scopes the cache to exactly that
// request: entries are collected when the request is, so there's no cross-request
// leakage and nothing to invalidate. Callers that don't thread a Request through
// simply skip the cache and compute directly.

const caches = new WeakMap<Request, Map<string, Promise<unknown>>>();

/**
 * Run `compute` at most once per (request, key) pair, sharing the in-flight
 * promise with any concurrent caller. Rejections aren't cached — a failed
 * computation is evicted so a retry within the same request can re-run.
 */
export function cachedForRequest<T>(
  request: Request,
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  let byKey = caches.get(request);
  if (!byKey) {
    byKey = new Map();
    caches.set(request, byKey);
  }
  const existing = byKey.get(key);
  if (existing) return existing as Promise<T>;

  const promise = compute().catch((err) => {
    byKey!.delete(key);
    throw err;
  });
  byKey.set(key, promise);
  return promise;
}
