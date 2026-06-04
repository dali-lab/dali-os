// In-memory pub/sub for live staffing-board updates. A board mutation
// (assign / finalize / board-member) calls publish(cycleId); every SSE client
// subscribed to that cycle gets pinged and revalidates its loader.
//
// SCOPE: this bus is per-process. Prod runs multiple Fly machines
// (min_machines_running >= 2), so a viewer on machine A will NOT receive
// events published on machine B. That trade-off was accepted deliberately:
// the SSE route also emits a low-frequency heartbeat the client treats as a
// re-sync cue, so cross-instance edits still converge within that window
// rather than never. If we later need exact cross-instance fan-out, swap the
// internals here for Postgres LISTEN/NOTIFY (on DIRECT_URL) without touching
// callers.

type Subscriber = () => void;

// cycleId → set of subscriber callbacks (one per open SSE connection).
const subscribers = new Map<string, Set<Subscriber>>();

// Survive Vite HMR / module re-evaluation in dev: keep one registry on global.
const g = globalThis as unknown as { __staffingSubs?: Map<string, Set<Subscriber>> };
const registry = g.__staffingSubs ?? subscribers;
if (!g.__staffingSubs) g.__staffingSubs = registry;

export function subscribeToCycle(cycleId: string, onEvent: Subscriber): () => void {
  let set = registry.get(cycleId);
  if (!set) {
    set = new Set();
    registry.set(cycleId, set);
  }
  set.add(onEvent);
  return () => {
    const s = registry.get(cycleId);
    if (!s) return;
    s.delete(onEvent);
    if (s.size === 0) registry.delete(cycleId);
  };
}

export function publishCycleChange(cycleId: string): void {
  const set = registry.get(cycleId);
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
