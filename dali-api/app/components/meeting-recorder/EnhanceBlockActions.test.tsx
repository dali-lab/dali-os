// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { EnhanceBlockActions } from "./EnhanceBlockActions";
import { makeRec, mountDom } from "./test-support";
import type { UseMeetingRecording } from "./use-meeting-recording";

let editorRoot: HTMLElement;

function buildEditor() {
  editorRoot = document.createElement("div");
  editorRoot.innerHTML = `
    <div class="bn-block-outer" data-id="b1"><div class="bn-block"><div class="bn-block-content"><p>Changed line</p></div></div></div>
    <div class="bn-block-outer" data-id="b2"><div class="bn-block"><div class="bn-block-content"><p>Added line</p></div></div></div>
    <div class="bn-block-outer" data-id="b3"><div class="bn-block"><div class="bn-block-content"><p>Typed line</p></div></div></div>`;
  document.body.appendChild(editorRoot);
}

afterEach(() => {
  document.body.innerHTML = "";
  for (const style of document.head.querySelectorAll("style[data-enhance-rules]")) style.remove();
});

const wasRules = () => document.querySelector('style[data-enhance-rules="was"]')?.textContent ?? "";

const marks = [
  { id: "b1", mark: "enhance-added" as const, type: "paragraph", text: "Changed line" },
  { id: "b2", mark: "enhance-added" as const, type: "paragraph", text: "Added line" },
];

function recWith(extra: Partial<UseMeetingRecording> = {}) {
  return makeRec({
    phase: "done",
    pendingMarks: marks,
    enhanceNotes: {
      plan: { blocks: [], actionItems: [] },
      verified: { droppedBlocks: 0, droppedCites: 0, unmatchedOwners: 0 },
      snapshotAt: "x",
      snapshot: [],
      priorBlocks: { b1: { id: "b1", type: "paragraph", content: [{ type: "text", text: "my rough line", styles: {} }] } },
    },
    ...extra,
  });
}

function mount(rec: UseMeetingRecording) {
  buildEditor();
  return mountDom(createElement(EnhanceBlockActions, { rec, getRoot: () => editorRoot }));
}

function hover(id: string) {
  const target = editorRoot.querySelector(`[data-id="${id}"] p`)!;
  act(() => {
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

const pill = () => document.querySelector("[data-enhance-actions]");
const btn = (prefix: string) => document.querySelector(`button[aria-label^="${prefix}"]`) as HTMLButtonElement;

describe("EnhanceBlockActions", () => {
  it("shows nothing until a marked block is hovered", () => {
    const { unmount } = mount(recWith());
    expect(pill()).toBeNull();
    unmount();
  });

  it("shows the pill for a hovered pending block with the first line in its labels", () => {
    const { unmount } = mount(recWith());
    hover("b2");
    expect(pill()!.getAttribute("data-enhance-actions")).toBe("b2");
    expect(btn("Keep change")!.getAttribute("aria-label")).toBe("Keep change: Added line");
    expect(btn("Revert change")!.getAttribute("aria-label")).toBe("Revert change: Added line");
    unmount();
  });

  it("ignores blocks that carry no mark", () => {
    const { unmount } = mount(recWith());
    hover("b3");
    expect(pill()).toBeNull();
    unmount();
  });

  it("Keep and Revert call the rec with the block id", () => {
    const rec = recWith();
    const { unmount } = mount(rec);
    hover("b1");
    act(() => btn("Keep change").click());
    expect(rec.keepBlock).toHaveBeenCalledWith("b1");
    act(() => btn("Revert change").click());
    expect(rec.revertBlock).toHaveBeenCalledWith("b1");
    unmount();
  });

  it("mousedown is default-prevented so the editor keeps focus", () => {
    const { unmount } = mount(recWith());
    hover("b1");
    for (const prefix of ["Keep change", "Revert change"]) {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      act(() => {
        btn(prefix).dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
    }
    unmount();
  });

  it("follows the caret into a pending block", () => {
    const { unmount } = mount(recWith());
    const text = editorRoot.querySelector('[data-id="b2"] p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    act(() => {
      const sel = document.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(pill()!.getAttribute("data-enhance-actions")).toBe("b2");
    unmount();
  });

  it("renders no pill for a viewer who cannot edit", () => {
    const { unmount } = mount(recWith({ canEdit: false }));
    hover("b1");
    expect(pill()).toBeNull();
    unmount();
  });

  it("shows 'You wrote' under a changed block only, and reserves its space with a generated rule", () => {
    const { unmount } = mount(recWith());
    expect(document.querySelector('[data-was-for="b1"]')!.textContent).toBe("You wrote: “my rough line”");
    expect(document.querySelector('[data-was-for="b2"]')).toBeNull();
    expect(wasRules()).toContain('.dali-doc .bn-block-outer[data-id="b1"] > .bn-block > .bn-block-content { padding-bottom: 28px; }');
    expect(wasRules()).not.toContain('data-id="b2"');
    expect(editorRoot.querySelectorAll("[data-id]")[0]!.attributes).toHaveLength(2);
    unmount();
    expect(document.querySelector("style[data-enhance-rules]")).toBeNull();
  });

  it("never sets an attribute on the editor's nodes, even when its observers fire", async () => {
    const spy = vi.spyOn(Element.prototype, "setAttribute");
    const { unmount } = mount(recWith());
    editorRoot.querySelector('[data-id="b1"] p')!.textContent = "Changed line again";
    editorRoot.appendChild(document.createElement("div"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const onEditor = spy.mock.contexts.filter((el) => el instanceof Element && editorRoot.contains(el));
    expect(onEditor).toHaveLength(0);
    expect(editorRoot.querySelectorAll("[data-enhance-was], [style]")).toHaveLength(0);
    expect(wasRules()).toContain('data-id="b1"');
    spy.mockRestore();
    unmount();
  });

  it("holds the reserved space while the line fades out, then releases it", async () => {
    const rec = recWith();
    const { unmount, rerender } = mount(rec);
    expect(wasRules()).toContain('data-id="b1"');
    rerender(createElement(EnhanceBlockActions, { rec: recWith({ pendingMarks: [] }), getRoot: () => editorRoot }));
    expect(document.querySelector('[data-was-for="b1"]')).not.toBeNull();
    expect(wasRules()).toContain('data-id="b1"');
    unmount();
  });

  it("hides overlays whose block is scrolled out of the editor's visible area", () => {
    const rects: Record<string, DOMRect> = {};
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const id = this.closest("[data-id]")?.getAttribute("data-id");
      return (id && this.classList.contains("bn-block-content") ? rects[id] : undefined) ?? original.call(this);
    };
    const box = (top: number) => ({ top, bottom: top + 40, left: 0, right: 500, width: 500, height: 40, x: 0, y: top, toJSON() {} }) as DOMRect;
    rects.b1 = box(10);
    const bar = document.createElement("div");
    bar.setAttribute("data-enhance-bar", "");
    bar.getBoundingClientRect = () => ({ ...box(0), bottom: 80 }) as DOMRect;
    document.body.appendChild(bar);
    const { unmount } = mount(recWith());
    expect(document.querySelector('[data-was-for="b1"]')).toBeNull();
    unmount();
    rects.b1 = box(200);
    const again = mount(recWith());
    expect(document.querySelector('[data-was-for="b1"]')).not.toBeNull();
    again.unmount();
    Element.prototype.getBoundingClientRect = original;
  });

  describe("pill placement", () => {
    const original = Element.prototype.getBoundingClientRect;
    const width = window.innerWidth;
    afterEach(() => {
      Element.prototype.getBoundingClientRect = original;
      window.innerWidth = width;
    });

    function mountWithBlockRect(viewportWidth: number, editorRight = viewportWidth) {
      window.innerWidth = viewportWidth;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        const isB2 = this.classList.contains("bn-block-content") && this.closest("[data-id]")?.getAttribute("data-id") === "b2";
        if (isB2) return { top: 300, bottom: 340, left: 100, right: 500, width: 400, height: 40, x: 100, y: 300, toJSON() {} } as DOMRect;
        return { top: 0, bottom: 0, left: 0, right: editorRight, width: editorRight, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
      };
      const ui = mount(recWith());
      hover("b2");
      return { ui, style: (pill() as HTMLElement).style };
    }

    it("sits in the right gutter, centred on the first line, when there is room beside the column", () => {
      const { ui, style } = mountWithBlockRect(1000);
      expect(style.left).toBe("508px");
      expect(style.top).toBe("298px");
      expect(style.right).toBe("");
      ui.unmount();
    });

    it("moves above the block when the editor column ends before the gutter would fit, even on a wide viewport", () => {
      const { ui, style } = mountWithBlockRect(1440, 600);
      expect(style.right).toBe(`${1440 - 500}px`);
      expect(style.left).toBe("");
      ui.unmount();
    });

    it("moves above the block's top-right corner when the gutter is too narrow", () => {
      const { ui, style } = mountWithBlockRect(600);
      expect(style.bottom).toBe(`${window.innerHeight - 300 + 4}px`);
      expect(style.right).toBe("100px");
      expect(style.left).toBe("");
      ui.unmount();
    });
  });

  it("renders nothing once no marks remain", () => {
    const { unmount } = mount(recWith({ pendingMarks: [] }));
    hover("b1");
    expect(pill()).toBeNull();
    expect(document.querySelector("[data-was-for]")).toBeNull();
    unmount();
  });
});
