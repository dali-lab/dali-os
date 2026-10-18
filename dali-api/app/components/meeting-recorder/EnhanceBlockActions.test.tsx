// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { EnhanceBlockActions, WAS_ATTR } from "./EnhanceBlockActions";
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
});

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

  it("shows 'You wrote' under a changed block only, and reserves its space", () => {
    const { unmount } = mount(recWith());
    expect(document.querySelector('[data-was-for="b1"]')!.textContent).toBe("You wrote: “my rough line”");
    expect(document.querySelector('[data-was-for="b2"]')).toBeNull();
    expect(editorRoot.querySelector('[data-id="b1"]')!.hasAttribute(WAS_ATTR)).toBe(true);
    expect(editorRoot.querySelector('[data-id="b2"]')!.hasAttribute(WAS_ATTR)).toBe(false);
    unmount();
    expect(editorRoot.querySelector('[data-id="b1"]')!.hasAttribute(WAS_ATTR)).toBe(false);
  });

  it("renders nothing once no marks remain", () => {
    const { unmount } = mount(recWith({ pendingMarks: [] }));
    hover("b1");
    expect(pill()).toBeNull();
    expect(document.querySelector("[data-was-for]")).toBeNull();
    unmount();
  });
});
