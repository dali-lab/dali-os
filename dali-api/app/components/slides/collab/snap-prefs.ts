import { useCallback, useState } from "react";

export interface SnapPrefs {
  items: boolean;
  margins: boolean;
  grid: boolean;
}

export const DEFAULT_SNAP_PREFS: SnapPrefs = { items: true, margins: true, grid: false };
export const SNAP_PREFS_KEY = "dali.slides.snap";

export function readSnapPrefs(key: string = SNAP_PREFS_KEY): SnapPrefs {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return DEFAULT_SNAP_PREFS;
    const parsed = JSON.parse(raw) as Partial<SnapPrefs>;
    return {
      items: typeof parsed.items === "boolean" ? parsed.items : DEFAULT_SNAP_PREFS.items,
      margins: typeof parsed.margins === "boolean" ? parsed.margins : DEFAULT_SNAP_PREFS.margins,
      grid: typeof parsed.grid === "boolean" ? parsed.grid : DEFAULT_SNAP_PREFS.grid,
    };
  } catch {
    return DEFAULT_SNAP_PREFS;
  }
}

export function writeSnapPrefs(prefs: SnapPrefs, key: string = SNAP_PREFS_KEY): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    return;
  }
}

export function useSnapPrefs(storageKey: string = SNAP_PREFS_KEY): [SnapPrefs, (patch: Partial<SnapPrefs>) => void] {
  const [prefs, setPrefs] = useState<SnapPrefs>(() => (typeof window === "undefined" ? DEFAULT_SNAP_PREFS : readSnapPrefs(storageKey)));
  const update = useCallback((patch: Partial<SnapPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      writeSnapPrefs(next, storageKey);
      return next;
    });
  }, [storageKey]);
  return [prefs, update];
}
