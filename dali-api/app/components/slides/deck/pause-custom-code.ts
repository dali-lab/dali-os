import { useSyncExternalStore } from "react";

export const PAUSE_KEY = "dali-slides-pause-custom-code";

const listeners = new Set<() => void>();
let fallback = false;

function read(): boolean {
  try {
    return window.localStorage.getItem(PAUSE_KEY) === "1";
  } catch {
    return fallback;
  }
}

export function setCustomCodePaused(paused: boolean): void {
  fallback = paused;
  try {
    window.localStorage.setItem(PAUSE_KEY, paused ? "1" : "0");
  } catch {}
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === PAUSE_KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** Whether this viewer has paused custom HTML. Stored per browser, off by default. */
export function useCustomCodePaused(): [boolean, (paused: boolean) => void] {
  const paused = useSyncExternalStore(subscribe, read, () => false);
  return [paused, setCustomCodePaused];
}
