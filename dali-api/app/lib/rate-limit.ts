const CLEANUP_INTERVAL_MS = 60_000;

const hits = new Map<string, number[]>();

// Periodically purge expired entries so the map doesn't grow unbounded.
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of hits) {
    const fresh = timestamps.filter((t) => t > now - CLEANUP_INTERVAL_MS);
    if (fresh.length === 0) hits.delete(key);
    else hits.set(key, fresh);
  }
}, CLEANUP_INTERVAL_MS);
// unref exists only on Node's Timeout — in a browser setInterval returns a
// number. Optional-call so this module can't crash a page at init if it ever
// gets pulled into a client bundle again (it took down the activity viewer).
cleanup.unref?.();

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
  const id = key ?? getClientIp(request);
  const now = Date.now();
  const timestamps = (hits.get(id) ?? []).filter((t) => t > now - windowMs);

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
  hits.set(id, timestamps);
  return null;
}

/** Reset all state — for testing only. */
export function _resetForTests() {
  hits.clear();
}
