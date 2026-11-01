// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COPY_LINK_SHORTCUT,
  historyShortcut,
  isCommandKShortcut,
  isCopyPageLinkShortcut,
  isEditingTarget,
  isFavoriteShortcut,
  isFindShortcut,
  isToggleSidebarShortcut,
  isVersionHistoryShortcut,
  modKey,
  paintFormatShortcut,
  SHORTCUT_SECTIONS,
  tabCycleShortcut,
} from "../shortcuts";

const base = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: "" };

const onMac = () => vi.stubGlobal("navigator", { platform: "MacIntel" });
afterEach(() => vi.unstubAllGlobals());

function editable(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild!;
}

describe("modKey", () => {
  it("is cmd or ctrl off a Mac", () => {
    expect(modKey({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(modKey({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(modKey({ metaKey: false, ctrlKey: false })).toBe(false);
  });
  it("is only cmd on a Mac", () => {
    onMac();
    expect(modKey({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(modKey({ metaKey: false, ctrlKey: true })).toBe(false);
  });
});

describe("Mac text editing keys", () => {
  it("leaves ⌃K, ⌃D and ⌃F to the text field", () => {
    onMac();
    expect(isCommandKShortcut({ ...base, ctrlKey: true, key: "k" })).toBe(false);
    expect(isFavoriteShortcut({ ...base, ctrlKey: true, key: "d" })).toBe(false);
    expect(isFindShortcut({ ...base, ctrlKey: true, key: "f" })).toBe(false);
  });
  it("still takes the ⌘ versions", () => {
    onMac();
    expect(isCommandKShortcut({ ...base, metaKey: true, key: "k" })).toBe(true);
    expect(isFavoriteShortcut({ ...base, metaKey: true, key: "d" })).toBe(true);
    expect(isFindShortcut({ ...base, metaKey: true, key: "f" })).toBe(true);
  });
  it("keeps Ctrl+Tab, which is Ctrl on every platform", () => {
    onMac();
    expect(tabCycleShortcut({ ...base, ctrlKey: true, key: "Tab" })).toBe(1);
  });
});

describe("isCommandKShortcut and isFavoriteShortcut", () => {
  it("match with ctrl off a Mac and in either case", () => {
    expect(isCommandKShortcut({ ...base, ctrlKey: true, key: "K" })).toBe(true);
    expect(isFavoriteShortcut({ ...base, ctrlKey: true, key: "D" })).toBe(true);
  });
  it("ignore extra modifiers", () => {
    expect(isCommandKShortcut({ ...base, metaKey: true, shiftKey: true, key: "k" })).toBe(false);
    expect(isFavoriteShortcut({ ...base, metaKey: true, altKey: true, key: "d" })).toBe(false);
  });
});

describe("isCopyPageLinkShortcut", () => {
  const press = { ...base, shiftKey: true, key: "c" };
  it("matches cmd or ctrl with shift and C in either case", () => {
    expect(isCopyPageLinkShortcut({ ...press, metaKey: true })).toBe(true);
    expect(isCopyPageLinkShortcut({ ...press, metaKey: true, key: "C" })).toBe(true);
    expect(isCopyPageLinkShortcut({ ...press, ctrlKey: true })).toBe(true);
  });
  it("ignores partial combos and other keys", () => {
    expect(isCopyPageLinkShortcut(press)).toBe(false);
    expect(isCopyPageLinkShortcut({ ...press, metaKey: true, shiftKey: false })).toBe(false);
    expect(isCopyPageLinkShortcut({ ...press, metaKey: true, altKey: true })).toBe(false);
    expect(isCopyPageLinkShortcut({ ...press, metaKey: true, key: "k" })).toBe(false);
  });
});

describe("historyShortcut", () => {
  const alt = { ...base, altKey: true };
  it("walks history with cmd brackets and option arrows", () => {
    expect(historyShortcut({ ...base, metaKey: true, key: "[" })).toBe("back");
    expect(historyShortcut({ ...base, metaKey: true, key: "]" })).toBe("forward");
    expect(historyShortcut({ ...alt, key: "ArrowLeft", target: document.body })).toBe("back");
    expect(historyShortcut({ ...alt, key: "ArrowRight", target: document.body })).toBe("forward");
  });
  it("leaves option arrows to anywhere you can type, so they move by word", () => {
    for (const html of ["<input>", "<textarea></textarea>", "<div contenteditable></div>", '<div class="ProseMirror"><p></p></div>']) {
      const target = editable(html);
      expect(historyShortcut({ ...alt, key: "ArrowLeft", target })).toBeNull();
      expect(historyShortcut({ ...alt, key: "ArrowRight", target })).toBeNull();
    }
  });
  it("keeps cmd brackets while typing", () => {
    expect(historyShortcut({ ...base, metaKey: true, key: "[", target: editable("<input>") })).toBe("back");
  });
  it("leaves the tab chords and other keys alone", () => {
    expect(historyShortcut({ ...base, metaKey: true, shiftKey: true, key: "[" })).toBeNull();
    expect(historyShortcut({ ...alt, metaKey: true, key: "ArrowLeft" })).toBeNull();
    expect(historyShortcut({ ...alt, ctrlKey: true, key: "ArrowLeft" })).toBeNull();
    expect(historyShortcut({ ...alt, shiftKey: true, key: "ArrowLeft" })).toBeNull();
    expect(historyShortcut({ ...alt, key: "a" })).toBeNull();
  });
});

describe("paintFormatShortcut", () => {
  const press = { ...base, metaKey: true, shiftKey: true };
  it("copies formatting from a selection", () => {
    expect(paintFormatShortcut({ ...press, key: "c" }, { selection: true, copied: false })).toBe("copy");
  });
  it("applies only when formatting is waiting", () => {
    expect(paintFormatShortcut({ ...press, key: "v" }, { selection: true, copied: true })).toBe("apply");
    expect(paintFormatShortcut({ ...press, key: "V" }, { selection: true, copied: true })).toBe("apply");
  });
  it("leaves paste without formatting alone when nothing is waiting", () => {
    expect(paintFormatShortcut({ ...press, key: "v" }, { selection: true, copied: false })).toBeNull();
  });
  it("needs a selection and the exact chord", () => {
    expect(paintFormatShortcut({ ...press, key: "c" }, { selection: false, copied: false })).toBeNull();
    expect(paintFormatShortcut({ ...press, shiftKey: false, key: "c" }, { selection: true, copied: false })).toBeNull();
    expect(paintFormatShortcut({ ...press, altKey: true, key: "c" }, { selection: true, copied: false })).toBeNull();
    expect(paintFormatShortcut({ ...press, key: "x" }, { selection: true, copied: true })).toBeNull();
  });
});

describe("isEditingTarget", () => {
  it("is false for plain elements, null, and non-elements", () => {
    expect(isEditingTarget(document.body)).toBe(false);
    expect(isEditingTarget(null)).toBe(false);
    expect(isEditingTarget(editable('<div contenteditable="false"></div>'))).toBe(false);
    expect(isEditingTarget(window)).toBe(false);
  });
});

describe("SHORTCUT_SECTIONS", () => {
  const rows = SHORTCUT_SECTIONS.flatMap((s) => s.rows);
  it("lists each binding once per section and action", () => {
    for (const section of SHORTCUT_SECTIONS) {
      const ids = section.rows.map((r) => `${r.keys} ${r.action}`);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it("covers the app, the tabs, and the three pages with their own keys", () => {
    expect(SHORTCUT_SECTIONS.map((s) => s.title)).toEqual([
      "General",
      "Desktop app tabs",
      "Desktop app navigation",
      "Docs",
      "Calendar",
      "Drive",
    ]);
    expect(rows.map((r) => r.keys)).toContain(COPY_LINK_SHORTCUT);
  });
  it("stays out of the removed split-pane bindings and em dashes", () => {
    expect(rows.map((r) => r.keys)).not.toContain("⌘⌥0");
    expect(rows.every((r) => !r.action.includes("—"))).toBe(true);
  });
});

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
