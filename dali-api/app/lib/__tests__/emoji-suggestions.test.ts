// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMOJI_SUGGESTIONS_KEY,
  readEmojiSuggestionsPreference,
  setEmojiSuggestionsPreference,
} from "~/lib/emoji-suggestions";

describe("emoji suggestions preference", () => {
  // Stubbed rather than jsdom's own: newer Node ships a global localStorage
  // that shadows it and is undefined without --localstorage-file.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it("is off when nothing is stored", () => {
    expect(readEmojiSuggestionsPreference()).toBe(false);
  });

  it("round-trips on and off", () => {
    setEmojiSuggestionsPreference(true);
    expect(readEmojiSuggestionsPreference()).toBe(true);
    setEmojiSuggestionsPreference(false);
    expect(readEmojiSuggestionsPreference()).toBe(false);
    expect(window.localStorage.getItem(EMOJI_SUGGESTIONS_KEY)).toBeNull();
  });
});
