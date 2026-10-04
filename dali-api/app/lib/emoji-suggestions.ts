// Device-scoped opt-in for the doc editor's ":" emoji picker. Off by default:
// a colon is too common in ordinary writing (times, "Note:", URLs) to pop a
// grid over. localStorage, not a cookie — only the client-only editor reads it.

export const EMOJI_SUGGESTIONS_KEY = "dali:doc-emoji-suggestions";

export function readEmojiSuggestionsPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(EMOJI_SUGGESTIONS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setEmojiSuggestionsPreference(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(EMOJI_SUGGESTIONS_KEY, "1");
    else window.localStorage.removeItem(EMOJI_SUGGESTIONS_KEY);
  } catch {
    // Storage unavailable (private mode) — the picker just stays off.
  }
}
