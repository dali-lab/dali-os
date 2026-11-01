import { describe, expect, it } from "vitest";
import { isToggleSidebarShortcut, isVersionHistoryShortcut, tabCycleShortcut } from "../shortcuts";

const base = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: "" };

describe("tabCycleShortcut", () => {
  it("cycles with ctrl+tab and ctrl+shift+tab", () => {
    expect(tabCycleShortcut({ ...base, ctrlKey: true, key: "Tab" })).toBe(1);
    expect(tabCycleShortcut({ ...base, ctrlKey: true, shiftKey: true, key: "Tab" })).toBe(-1);
  });
  it("cycles with cmd or ctrl, shift and a bracket, as the shifted key WebKit reports", () => {
    expect(tabCycleShortcut({ ...base, metaKey: true, shiftKey: true, key: "}" })).toBe(1);
    expect(tabCycleShortcut({ ...base, metaKey: true, shiftKey: true, key: "{" })).toBe(-1);
    expect(tabCycleShortcut({ ...base, ctrlKey: true, shiftKey: true, key: "}" })).toBe(1);
    expect(tabCycleShortcut({ ...base, ctrlKey: true, shiftKey: true, key: "{" })).toBe(-1);
  });
  it("accepts an unshifted bracket key value", () => {
    expect(tabCycleShortcut({ ...base, metaKey: true, shiftKey: true, key: "]" })).toBe(1);
    expect(tabCycleShortcut({ ...base, metaKey: true, shiftKey: true, key: "[" })).toBe(-1);
  });
  it("keeps cmd+option+arrows", () => {
    expect(tabCycleShortcut({ ...base, metaKey: true, altKey: true, key: "ArrowRight" })).toBe(1);
    expect(tabCycleShortcut({ ...base, metaKey: true, altKey: true, key: "ArrowLeft" })).toBe(-1);
  });
  it("leaves plain tab, cmd+tab, and the back/forward chords alone", () => {
    expect(tabCycleShortcut({ ...base, key: "Tab" })).toBeNull();
    expect(tabCycleShortcut({ ...base, shiftKey: true, key: "Tab" })).toBeNull();
    expect(tabCycleShortcut({ ...base, metaKey: true, key: "Tab" })).toBeNull();
    expect(tabCycleShortcut({ ...base, ctrlKey: true, altKey: true, key: "Tab" })).toBeNull();
    expect(tabCycleShortcut({ ...base, metaKey: true, key: "[" })).toBeNull();
    expect(tabCycleShortcut({ ...base, metaKey: true, key: "]" })).toBeNull();
    expect(tabCycleShortcut({ ...base, altKey: true, key: "ArrowLeft" })).toBeNull();
  });
  it("ignores brackets without the modifiers and other chords", () => {
    expect(tabCycleShortcut({ ...base, shiftKey: true, key: "}" })).toBeNull();
    expect(tabCycleShortcut({ ...base, metaKey: true, shiftKey: true, altKey: true, key: "}" })).toBeNull();
    expect(tabCycleShortcut({ ...base, metaKey: true, shiftKey: true, key: "ArrowRight" })).toBeNull();
    expect(tabCycleShortcut({ ...base, metaKey: true, shiftKey: true, key: "k" })).toBeNull();
  });
});

describe("isToggleSidebarShortcut", () => {
  const press = { ...base, key: "\\" };
  it("matches cmd or ctrl with backslash", () => {
    expect(isToggleSidebarShortcut({ ...press, metaKey: true })).toBe(true);
    expect(isToggleSidebarShortcut({ ...press, ctrlKey: true })).toBe(true);
  });
  it("ignores partial combos and other keys", () => {
    expect(isToggleSidebarShortcut(press)).toBe(false);
    expect(isToggleSidebarShortcut({ ...press, metaKey: true, shiftKey: true })).toBe(false);
    expect(isToggleSidebarShortcut({ ...press, metaKey: true, altKey: true })).toBe(false);
    expect(isToggleSidebarShortcut({ ...base, metaKey: true, key: "k" })).toBe(false);
  });
  it("respects defaultPrevented", () => {
    expect(isToggleSidebarShortcut({ ...press, metaKey: true, defaultPrevented: true })).toBe(false);
  });
});

describe("isVersionHistoryShortcut", () => {
  const press = { ...base, shiftKey: true, altKey: true, key: "˙", code: "KeyH" };
  it("matches cmd or ctrl with option, shift and H, even when option remaps the key", () => {
    expect(isVersionHistoryShortcut({ ...press, metaKey: true })).toBe(true);
    expect(isVersionHistoryShortcut({ ...press, ctrlKey: true })).toBe(true);
    expect(isVersionHistoryShortcut({ ...press, metaKey: true, key: "H", code: undefined })).toBe(true);
  });
  it("ignores partial combos", () => {
    expect(isVersionHistoryShortcut(press)).toBe(false);
    expect(isVersionHistoryShortcut({ ...press, metaKey: true, shiftKey: false })).toBe(false);
    expect(isVersionHistoryShortcut({ ...press, metaKey: true, altKey: false })).toBe(false);
    expect(isVersionHistoryShortcut({ ...press, metaKey: true, key: "j", code: "KeyJ" })).toBe(false);
  });
  it("respects defaultPrevented", () => {
    expect(isVersionHistoryShortcut({ ...press, metaKey: true, defaultPrevented: true })).toBe(false);
  });
});
