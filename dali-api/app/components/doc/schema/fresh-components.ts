const fresh = new Set<string>();
const listeners = new Set<() => void>();

export function markFreshComponent(blockId: string) {
  fresh.add(blockId);
  listeners.forEach((l) => l());
}

export function takeFreshComponent(blockId: string): boolean {
  return fresh.delete(blockId);
}

export function onFreshComponent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
