// Device-scoped opt-in: Tab also accepts the highlighted item in a doc's
// / command and @ mention menus. Off by default while it rolls out.

export const TAB_ACCEPTS_SUGGESTION_KEY = "dali:doc-tab-accepts-suggestion";

export function readTabAcceptsSuggestionPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TAB_ACCEPTS_SUGGESTION_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTabAcceptsSuggestionPreference(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(TAB_ACCEPTS_SUGGESTION_KEY, "1");
    else window.localStorage.removeItem(TAB_ACCEPTS_SUGGESTION_KEY);
  } catch {
    // Storage unavailable (private mode); Tab keeps its default behavior.
  }
}
