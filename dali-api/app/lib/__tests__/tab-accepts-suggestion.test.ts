// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TAB_ACCEPTS_SUGGESTION_KEY,
  readTabAcceptsSuggestionPreference,
  setTabAcceptsSuggestionPreference,
} from "~/lib/tab-accepts-suggestion";

describe("tab accepts suggestion preference", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it("is off when nothing is stored", () => {
    expect(readTabAcceptsSuggestionPreference()).toBe(false);
  });

  it("round-trips on and off, clearing the key when off", () => {
    setTabAcceptsSuggestionPreference(true);
    expect(readTabAcceptsSuggestionPreference()).toBe(true);
    setTabAcceptsSuggestionPreference(false);
    expect(readTabAcceptsSuggestionPreference()).toBe(false);
    expect(window.localStorage.getItem(TAB_ACCEPTS_SUGGESTION_KEY)).toBeNull();
  });

  it("stays off when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => setTabAcceptsSuggestionPreference(true)).not.toThrow();
    expect(readTabAcceptsSuggestionPreference()).toBe(false);
  });
});
