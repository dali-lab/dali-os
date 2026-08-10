// Per-request server-timing collector. Loaders wrap awaited work with `timed()`;
// entry.server's handleDataRequest reads the marks off the Request and emits a
// `Server-Timing` response header, so the per-phase breakdown shows up directly
// in the browser DevTools "Timing → Server Timing" panel (and in a HAR's
// response headers). Keyed by the Request object (same WeakMap-on-Request scoping
// as request-cache.ts) — nothing to clean up, no cross-request leakage. Purely
// diagnostic: no behavior change.

type Mark = { name: string; dur: number };

const marks = new WeakMap<Request, Mark[]>();

function record(request: Request, name: string, dur: number): void {
  let list = marks.get(request);
  if (!list) {
    list = [];
    marks.set(request, list);
  }
  list.push({ name, dur });
}

/**
 * Time an async unit of work and record it against the request. The thunk is
 * invoked immediately, so wrapping several `timed(...)` calls inside a
 * `Promise.all([...])` still runs them concurrently — each mark is that unit's
 * own wall-clock duration from start to settle.
 */
export function timed<T>(
  request: Request | undefined,
  name: string,
  thunk: () => Promise<T>,
): Promise<T> {
  if (!request) return thunk();
  const start = performance.now();
  const p = thunk();
  const done = () => record(request, name, performance.now() - start);
  p.then(done, done);
  return p;
}

/**
 * Build the `Server-Timing` header value from a request's recorded marks, or
 * null if nothing was recorded. Metric names are sanitized to the header's token
 * grammar.
 */
export function serverTimingHeader(request: Request): string | null {
  const list = marks.get(request);
  if (!list || list.length === 0) return null;
  return list
    .map((m) => `${m.name.replace(/[^\w-]/g, "_")};dur=${m.dur.toFixed(1)}`)
    .join(", ");
}

/** Largest single recorded phase (name + ms), for a coarse slow-request log. */
export function slowestMark(request: Request): { name: string; dur: number } | null {
  const list = marks.get(request);
  if (!list || list.length === 0) return null;
  return list.reduce((a, b) => (b.dur > a.dur ? b : a));
}
