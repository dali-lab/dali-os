import { useCallback, useState } from "react";

export interface SnapPrefs {
  items: boolean;
  margins: boolean;
  grid: boolean;
}

export const DEFAULT_SNAP_PREFS: SnapPrefs = { items: true, margins: true, grid: false };
export const SNAP_PREFS_KEY = "dali.slides.snap";

export function readSnapPrefs(): SnapPrefs {
  try {
    const raw = window.localStorage.getItem(SNAP_PREFS_KEY);
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

export function writeSnapPrefs(prefs: SnapPrefs): void {
  try {
    window.localStorage.setItem(SNAP_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    return;
  }
}

export function useSnapPrefs(): [SnapPrefs, (patch: Partial<SnapPrefs>) => void] {
  const [prefs, setPrefs] = useState<SnapPrefs>(() => (typeof window === "undefined" ? DEFAULT_SNAP_PREFS : readSnapPrefs()));
  const update = useCallback((patch: Partial<SnapPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      writeSnapPrefs(next);
      return next;
    });
  }, []);
  return [prefs, update];
}
