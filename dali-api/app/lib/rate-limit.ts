const CLEANUP_INTERVAL_MS = 60_000;

// windowMs is stored per key so cleanup knows how long timestamps stay
// relevant — purging on the cleanup interval alone silently collapsed any
// window longer than 60s (e.g. the 10-minute oauth/register window).
const hits = new Map<string, { windowMs: number; timestamps: number[] }>();

// Periodically purge expired entries so the map doesn't grow unbounded.
// Started lazily on the first checkRateLimit() call rather than at module load:
// a top-level setInterval is a module side effect that Vite/rolldown cannot
// tree-shake, which pinned this module — and its transitive `~/lib/db` import,
// the 4.8MB Prisma query-compiler wasm — into the client bundle of every route
// that (even transitively, via ~/lib/audit) imports it. Deferring the timer
// makes the module side-effect-free so it drops out of client chunks entirely.
// (This module previously took down the activity viewer when it leaked.)
let cleanupStarted = false;
function ensureCleanupTimer() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      const horizon = Math.max(entry.windowMs, CLEANUP_INTERVAL_MS);
      const fresh = entry.timestamps.filter((t) => t > now - horizon);
      if (fresh.length === 0) hits.delete(key);
      else entry.timestamps = fresh;
    }
  }, CLEANUP_INTERVAL_MS);
  // unref exists only on Node's Timeout — keep the process from being held open
  // by this housekeeping timer.
  cleanup.unref?.();
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("Fly-Client-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function checkRateLimit(
  request: Request,
  { max, windowMs }: { max: number; windowMs: number },
  key?: string,
): Response | null {
  ensureCleanupTimer();
  const id = key ?? getClientIp(request);
  const now = Date.now();
  const timestamps = (hits.get(id)?.timestamps ?? []).filter(
    (t) => t > now - windowMs,
  );

  if (timestamps.length >= max) {
    const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      },
    });
  }

  timestamps.push(now);
  hits.set(id, { windowMs, timestamps });
  return null;
}

/** Reset all state — for testing only. */
export function _resetForTests() {
  hits.clear();
}
