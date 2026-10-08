// Process-local TTL memoization for reads that are effectively static across
// requests (the Term calendar, active hiring cycles, feature-flag rows). The
// per-request cache (request-cache.ts) only dedupes within one navigation, so
// these rows were re-read from Postgres on every page load lab-wide.
//
// Scope is one Node process: each Fly machine has its own copy, so a write on
// one machine is visible on the others only once their entry expires. Writers
// call `clearTtlCache(prefix)` so the machine that handled the write never
// serves a stale read; keep TTLs short enough that cross-machine staleness is
// harmless for the data in question.
//
// Disabled under Vitest so unit tests that mock Prisma keep seeing one query
// per call; a test of the helper itself opts in via setTtlCacheEnabledForTests.

type Entry = { value: unknown; expiresAt: number };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

let enabledOverride: boolean | null = null;

function enabled(): boolean {
  if (enabledOverride !== null) return enabledOverride;
  return !process.env.VITEST;
}

/**
 * Run `compute` at most once per `ttlMs` for `key`, sharing an in-flight
 * promise with concurrent callers. A rejection is not cached.
 */
export function cachedForTtl<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  if (!enabled()) return compute();
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expiresAt > now) return Promise.resolve(hit.value as T);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = compute().then(
    (value) => {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      inflight.delete(key);
      return value;
    },
    (err) => {
      inflight.delete(key);
      throw err;
    },
  );
  inflight.set(key, promise);
  return promise;
}

/** Drop every entry whose key starts with `prefix` (all entries when omitted). */
export function clearTtlCache(prefix?: string): void {
  if (prefix === undefined) {
    entries.clear();
    inflight.clear();
    return;
  }
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
  for (const key of inflight.keys()) if (key.startsWith(prefix)) inflight.delete(key);
}

export function setTtlCacheEnabledForTests(value: boolean | null): void {
  enabledOverride = value;
  clearTtlCache();
}
