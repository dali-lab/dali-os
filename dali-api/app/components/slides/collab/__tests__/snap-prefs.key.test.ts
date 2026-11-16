// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readSnapPrefs, SNAP_PREFS_KEY, writeSnapPrefs } from "../snap-prefs";

afterEach(() => window.localStorage.clear());

describe("snap preferences under a custom key", () => {
  it("are stored apart from the slides preferences", () => {
    writeSnapPrefs({ items: false, margins: false, grid: true }, "dali.certificates.snap");
    expect(window.localStorage.getItem(SNAP_PREFS_KEY)).toBeNull();
    expect(readSnapPrefs("dali.certificates.snap")).toEqual({ items: false, margins: false, grid: true });
    expect(readSnapPrefs()).toEqual({ items: true, margins: true, grid: false });
  });
});
