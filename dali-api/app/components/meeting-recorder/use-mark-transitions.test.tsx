// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createElement } from "react";
import { mountDom } from "./test-support";
import { ANIM_ATTR, DELAY_VAR, planMarkTransitions, useMarkTransitions } from "./use-mark-transitions";
import type { EnhanceMarkEntry } from "./enhance-plan";

const mark = (id: string): EnhanceMarkEntry => ({ id, mark: "enhance-added", type: "paragraph", text: id });
const prior = (text: string) => ({ id: "x", type: "paragraph", content: [{ type: "text", text, styles: {} }] });

let root: HTMLElement;

function build(ids: string[]) {
  root = document.createElement("div");
  root.innerHTML = ids
    .map((id) => `<div class="bn-block-outer" data-id="${id}"><div class="bn-block"><div class="bn-block-content"><p class="bn-inline-content">${id} text</p></div></div></div>`)
    .join("");
  document.body.appendChild(root);
}

const el = (id: string) => root.querySelector(`[data-id="${id}"]`) as HTMLElement;

function Harness({ marks, priorBlocks }: { marks: EnhanceMarkEntry[]; priorBlocks?: Record<string, unknown> }) {
  useMarkTransitions({ marks, priorBlocks, getRoot: () => root });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("planMarkTransitions", () => {
  const exists = (ids: string[]) => (id: string) => ids.includes(id);
  const text = () => "";

  it("classifies appeared, cleared-with-block and cleared-without-block", () => {
    const plan = planMarkTransitions({
      prev: [mark("kept"), mark("gone")],
      next: [mark("new")],
      priorBlocks: undefined,
      blockExists: exists(["kept", "new"]),
      blockText: text,
    });
    expect(plan).toEqual([
      { id: "new", kind: "bloom", added: true },
      { id: "kept", kind: "drain", added: false },
    ]);
  });

  it("does nothing for identical lists", () => {
    expect(planMarkTransitions({ prev: [mark("a")], next: [mark("a")], priorBlocks: undefined, blockExists: () => true, blockText: text })).toEqual([]);
  });

  it("marks a changed block as bloom without added, and a restored one as revert", () => {
    const priorBlocks = { c: prior("my rough line") };
    expect(planMarkTransitions({ prev: [], next: [mark("c")], priorBlocks, blockExists: () => true, blockText: text })).toEqual([
      { id: "c", kind: "bloom", added: false },
    ]);
    expect(
      planMarkTransitions({ prev: [mark("c")], next: [], priorBlocks, blockExists: () => true, blockText: () => "my rough line" }),
    ).toEqual([{ id: "c", kind: "revert", added: false }]);
    expect(
      planMarkTransitions({ prev: [mark("c")], next: [], priorBlocks, blockExists: () => true, blockText: () => "Rewritten line" }),
    ).toEqual([{ id: "c", kind: "drain", added: false }]);
  });
});

describe("useMarkTransitions", () => {
  it("does not animate on first mount or when nothing changed", () => {
    build(["a"]);
    const ui = mountDom(createElement(Harness, { marks: [mark("a")] }));
    expect(el("a").hasAttribute(ANIM_ATTR)).toBe(false);
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    expect(el("a").hasAttribute(ANIM_ATTR)).toBe(false);
    ui.unmount();
  });

  it("blooms an appearing mark, then removes the attributes", () => {
    build(["a"]);
    const ui = mountDom(createElement(Harness, { marks: [] }));
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    expect(el("a").getAttribute(ANIM_ATTR)).toBe("bloom");
    vi.advanceTimersByTime(2000);
    expect(el("a").hasAttribute(ANIM_ATTR)).toBe(false);
    expect(el("a").style.getPropertyValue(DELAY_VAR)).toBe("");
    ui.unmount();
  });

  it("drains cleared marks with a 70ms stagger top to bottom (Keep all)", () => {
    build(["a", "b", "c"]);
    const ui = mountDom(createElement(Harness, { marks: [mark("a"), mark("b"), mark("c")] }));
    ui.rerender(createElement(Harness, { marks: [] }));
    expect(["a", "b", "c"].map((id) => el(id).getAttribute(ANIM_ATTR))).toEqual(["drain", "drain", "drain"]);
    expect(["a", "b", "c"].map((id) => el(id).style.getPropertyValue(DELAY_VAR))).toEqual(["0ms", "70ms", "140ms"]);
    vi.advanceTimersByTime(2000);
    expect(root.querySelectorAll(`[${ANIM_ATTR}]`)).toHaveLength(0);
    ui.unmount();
  });

  it("blooms again when an undo restores the mark", () => {
    build(["a"]);
    const ui = mountDom(createElement(Harness, { marks: [mark("a")] }));
    ui.rerender(createElement(Harness, { marks: [] }));
    vi.advanceTimersByTime(2000);
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    expect(el("a").getAttribute(ANIM_ATTR)).toBe("bloom");
    ui.unmount();
  });

  it("staggers simultaneous blooms by 90ms", () => {
    build(["a", "b"]);
    const ui = mountDom(createElement(Harness, { marks: [] }));
    ui.rerender(createElement(Harness, { marks: [mark("a"), mark("b")] }));
    expect(el("b").style.getPropertyValue(DELAY_VAR)).toBe("90ms");
    ui.unmount();
  });

  it("ignores a cleared mark whose block disappeared", () => {
    build(["a"]);
    const ui = mountDom(createElement(Harness, { marks: [mark("a"), mark("zz")] }));
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    expect(root.querySelectorAll(`[${ANIM_ATTR}]`)).toHaveLength(0);
    ui.unmount();
  });

  it("removes DOM-only attributes on unmount", () => {
    build(["a"]);
    const ui = mountDom(createElement(Harness, { marks: [] }));
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    ui.unmount();
    expect(el("a").hasAttribute(ANIM_ATTR)).toBe(false);
  });
});
