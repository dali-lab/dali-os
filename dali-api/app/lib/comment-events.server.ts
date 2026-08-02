// In-memory pub/sub for live comment-change delivery. The comments action
// (create / edit / resolve / delete) calls publishCommentChange(pageId);
// every SSE client subscribed to that page gets pinged and refetches threads.
//
// SCOPE: per-process, same deliberate trade-off as staffing-events.server.ts
// and notify-stream.server.ts. Prod runs multiple Fly machines, so a stream
// held by machine A misses events published on machine B; the SSE route's
// periodic `sync` event is the cross-instance backstop so delivery degrades
// to the polling cadence rather than never.

type Subscriber = () => void;

const subscribers = new Map<string, Set<Subscriber>>();

// Survive Vite HMR / module re-evaluation in dev: keep one registry on global.
const g = globalThis as unknown as { __commentEventSubs?: Map<string, Set<Subscriber>> };
const registry = g.__commentEventSubs ?? subscribers;
if (!g.__commentEventSubs) g.__commentEventSubs = registry;

export function subscribeToPageComments(pageId: string, onEvent: Subscriber): () => void {
  let set = registry.get(pageId);
  if (!set) {
    set = new Set();
    registry.set(pageId, set);
  }
  set.add(onEvent);
  return () => {
    const s = registry.get(pageId);
    if (!s) return;
    s.delete(onEvent);
    if (s.size === 0) registry.delete(pageId);
  };
}

export function publishCommentChange(pageId: string): void {
  const set = registry.get(pageId);
  if (!set) return;
  for (const fn of set) {
    // A throwing/closed subscriber must not block the rest.
    try {
      fn();
    } catch {
      // ignore — the SSE route cleans up its own subscription on close.
    }
  }
}
