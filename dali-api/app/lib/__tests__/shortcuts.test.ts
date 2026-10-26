import { describe, expect, it } from "vitest";
import { isToggleSidebarShortcut, isVersionHistoryShortcut } from "../shortcuts";

const base = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: "" };

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
