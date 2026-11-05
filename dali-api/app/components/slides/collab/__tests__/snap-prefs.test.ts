// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SNAP_PREFS, readSnapPrefs, SNAP_PREFS_KEY, writeSnapPrefs } from "../snap-prefs";

afterEach(() => {
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    return;
  }
});

describe("snap preferences", () => {
  it("default to snapping on, grid off", () => {
    expect(readSnapPrefs()).toEqual({ items: true, margins: true, grid: false });
  });

  it("round-trip through localStorage under one key", () => {
    writeSnapPrefs({ items: false, margins: true, grid: true });
    expect(JSON.parse(window.localStorage.getItem(SNAP_PREFS_KEY)!)).toEqual({ items: false, margins: true, grid: true });
    expect(readSnapPrefs()).toEqual({ items: false, margins: true, grid: true });
  });

  it("ignore junk and fill missing fields with defaults", () => {
    window.localStorage.setItem(SNAP_PREFS_KEY, "{oops");
    expect(readSnapPrefs()).toEqual(DEFAULT_SNAP_PREFS);
    window.localStorage.setItem(SNAP_PREFS_KEY, JSON.stringify({ items: "no", grid: true }));
    expect(readSnapPrefs()).toEqual({ items: true, margins: true, grid: true });
  });

  it("survive storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSnapPrefs()).toEqual(DEFAULT_SNAP_PREFS);
    expect(() => writeSnapPrefs(DEFAULT_SNAP_PREFS)).not.toThrow();
  });
});
