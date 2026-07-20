// In-memory pub/sub for live notification delivery. notify() (and the read
// endpoints, for badge convergence) call publishNotificationChange(userIds);
// every open notification stream for those users gets pinged and re-fetches
// its feed.
//
// SCOPE: per-process, same deliberate trade-off as staffing-events.server.ts.
// Prod runs multiple Fly machines, so a stream held by machine A misses
// events published on machine B; the SSE route's periodic `sync` event is the
// cross-instance backstop, so delivery degrades to roughly the old polling
// cadence rather than never. Swap these internals for Postgres LISTEN/NOTIFY
// (on DIRECT_URL) if exact cross-instance fan-out is ever needed.

type Subscriber = () => void;

const subscribers = new Map<string, Set<Subscriber>>();

// Survive Vite HMR / module re-evaluation in dev: keep one registry on global.
const g = globalThis as unknown as { __notifyStreamSubs?: Map<string, Set<Subscriber>> };
const registry = g.__notifyStreamSubs ?? subscribers;
if (!g.__notifyStreamSubs) g.__notifyStreamSubs = registry;

export function subscribeToUserNotifications(userId: string, onEvent: Subscriber): () => void {
  let set = registry.get(userId);
  if (!set) {
    set = new Set();
    registry.set(userId, set);
  }
  set.add(onEvent);
  return () => {
    const s = registry.get(userId);
    if (!s) return;
    s.delete(onEvent);
    if (s.size === 0) registry.delete(userId);
  };
}

export function publishNotificationChange(userIds: string[]): void {
  for (const userId of userIds) {
    const set = registry.get(userId);
    if (!set) continue;
    for (const fn of set) {
      // A throwing/closed subscriber must not block the rest.
      try {
        fn();
      } catch {
        // ignore — the SSE route cleans up its own subscription on close.
      }
    }
  }
}
