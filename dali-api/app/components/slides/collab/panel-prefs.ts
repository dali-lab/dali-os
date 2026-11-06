import { useCallback, useState } from "react";

export interface PanelPrefs {
  inspectorHidden: boolean;
  focus: boolean;
}

export const DEFAULT_PANEL_PREFS: PanelPrefs = { inspectorHidden: false, focus: false };
export const PANEL_PREFS_KEY = "dali.slides.panels";

export function readPanelPrefs(): PanelPrefs {
  try {
    const raw = window.localStorage.getItem(PANEL_PREFS_KEY);
    if (!raw) return DEFAULT_PANEL_PREFS;
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
    return {
      inspectorHidden: parsed.inspectorHidden === true,
      focus: parsed.focus === true,
    };
  } catch {
    return DEFAULT_PANEL_PREFS;
  }
}

export function writePanelPrefs(prefs: PanelPrefs): void {
  try {
    window.localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    return;
  }
}

export function usePanelPrefs() {
  const [prefs, setPrefs] = useState<PanelPrefs>(() => (typeof window === "undefined" ? DEFAULT_PANEL_PREFS : readPanelPrefs()));
  const update = useCallback((patch: (prev: PanelPrefs) => Partial<PanelPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch(prev) };
      writePanelPrefs(next);
      return next;
    });
  }, []);
  const toggleInspector = useCallback(() => update((p) => ({ inspectorHidden: !p.inspectorHidden })), [update]);
  const toggleFocus = useCallback(() => update((p) => ({ focus: !p.focus })), [update]);
  const exitFocus = useCallback(() => update(() => ({ focus: false })), [update]);
  const revealInspector = useCallback(() => update(() => ({ inspectorHidden: false, focus: false })), [update]);
  return { ...prefs, toggleInspector, toggleFocus, exitFocus, revealInspector };
}
