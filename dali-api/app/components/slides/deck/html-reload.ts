import { useSyncExternalStore } from "react";

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

/** Re-mounts the frame of one custom HTML element on this screen. */
export function reloadHtml(elementId: string): void {
  counts.set(elementId, (counts.get(elementId) ?? 0) + 1);
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const useHtmlReloads = (elementId: string): number => useSyncExternalStore(subscribe, () => counts.get(elementId) ?? 0, () => 0);
