// In-process pub/sub for live activity surfaces (specs/activities.md §7.6).
//
// SCOPE: per-process, the same deliberate trade-off as notify-stream.server.ts
// and staffing-events.server.ts. Prod runs multiple Fly machines, so a stream
// held by machine A misses events published on machine B; the SSE route's
// periodic `sync` event is the cross-instance backstop, so a leaderboard
// converges within that window rather than never. Swap these internals for
// Postgres LISTEN/NOTIFY (on DIRECT_URL) if exact cross-instance fan-out is ever
// needed — the subscribe/publish signatures stay the same.

type Subscriber = () => void;

// Keyed by activityId. On globalThis so HMR in dev doesn't strand subscribers.
const g = globalThis as unknown as {
  __activityStreamSubs?: Map<string, Set<Subscriber>>;
};
const registry = (g.__activityStreamSubs ??= new Map<string, Set<Subscriber>>());

export function subscribeToActivity(activityId: string, onEvent: Subscriber): () => void {
  let set = registry.get(activityId);
  if (!set) {
    set = new Set();
    registry.set(activityId, set);
  }
  set.add(onEvent);
  return () => {
    const s = registry.get(activityId);
    if (!s) return;
    s.delete(onEvent);
    if (s.size === 0) registry.delete(activityId);
  };
}

export function publishActivityChange(activityId: string): void {
  const set = registry.get(activityId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn();
    } catch {
      // ignore — the SSE route cleans up its own subscription on close.
    }
  }
}
