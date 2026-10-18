// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createElement, act } from "react";
import { mountDom } from "./test-support";
import { planMarkTransitions, useMarkTransitions } from "./use-mark-transitions";
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

const rules = () => document.querySelector('style[data-enhance-rules="anim"]')?.textContent ?? "";
const rule = (id: string, tail: string) => new RegExp(`\\[data-id="${id}"\\] > \\.bn-block${tail}`);
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

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
  for (const style of document.head.querySelectorAll("style[data-enhance-rules]")) style.remove();
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
    expect(rules()).toBe("");
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    expect(rules()).toBe("");
    ui.unmount();
  });

  it("blooms an appearing mark with a generated rule, then removes the style", () => {
    build(["a"]);
    const ui = mountDom(createElement(Harness, { marks: [] }));
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    expect(rules()).toMatch(rule("a", "::before \\{[^}]*animation: enhance-tint-in-a 360ms [^;]* 0ms both"));
    expect(rules()).toMatch(rule("a", "::after \\{[^}]*animation: enhance-edge-in-a 240ms"));
    advance(2000);
    expect(document.querySelector("style[data-enhance-rules]")).toBeNull();
    ui.unmount();
  });

  it("never writes an attribute or inline style onto an editor node", () => {
    build(["a", "b"]);
    const spy = vi.spyOn(Element.prototype, "setAttribute");
    const ui = mountDom(createElement(Harness, { marks: [mark("a"), mark("b")] }));
    ui.rerender(createElement(Harness, { marks: [] }));
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    advance(2000);
    const onEditor = spy.mock.contexts.filter((el) => el instanceof Element && root.contains(el));
    expect(onEditor).toHaveLength(0);
    expect(root.querySelectorAll("[style]")).toHaveLength(0);
    spy.mockRestore();
    ui.unmount();
  });

  it("drains cleared marks with a 70ms stagger top to bottom (Keep all)", () => {
    build(["a", "b", "c"]);
    const ui = mountDom(createElement(Harness, { marks: [mark("a"), mark("b"), mark("c")] }));
    ui.rerender(createElement(Harness, { marks: [] }));
    expect(rules()).toMatch(rule("a", "::before \\{[^}]*enhance-tint-out-a 240ms [^;]* 0ms both"));
    expect(rules()).toMatch(rule("b", "::before \\{[^}]*enhance-tint-out-a 240ms [^;]* 70ms both"));
    expect(rules()).toMatch(rule("c", "::before \\{[^}]*enhance-tint-out-a 240ms [^;]* 140ms both"));
    expect(rules()).toMatch(rule("a", "::after \\{[^}]*enhance-edge-out-a 200ms [^;]* 240ms both"));
    advance(2000);
    expect(rules()).toBe("");
    ui.unmount();
  });

  it("uses the revert fade when an undo restores the prior text", () => {
    build(["c"]);
    const priorBlocks = { c: prior("c text") };
    const ui = mountDom(createElement(Harness, { marks: [mark("c")], priorBlocks }));
    ui.rerender(createElement(Harness, { marks: [], priorBlocks }));
    expect(rules()).toContain("enhance-fade-out-a");
    ui.unmount();
  });

  it("blooms again when an undo restores the mark", () => {
    build(["a"]);
    const ui = mountDom(createElement(Harness, { marks: [mark("a")] }));
    ui.rerender(createElement(Harness, { marks: [] }));
    advance(2000);
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    expect(rules()).toContain("enhance-tint-in-a");
    ui.unmount();
  });

  it("swaps to the twin keyframes to restart a rule that is still running", () => {
    build(["a"]);
    const ui = mountDom(createElement(Harness, { marks: [] }));
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    expect(rules()).toContain("enhance-tint-in-a");
    ui.rerender(createElement(Harness, { marks: [] }));
    expect(rules()).toContain("enhance-tint-out-b");
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    expect(rules()).toContain("enhance-tint-in-a");
    ui.unmount();
  });

  it("staggers simultaneous blooms by 90ms", () => {
    build(["a", "b"]);
    const ui = mountDom(createElement(Harness, { marks: [] }));
    ui.rerender(createElement(Harness, { marks: [mark("a"), mark("b")] }));
    expect(rules()).toMatch(rule("b", "::before \\{[^}]*enhance-tint-in-a 360ms [^;]* 90ms both"));
    ui.unmount();
  });

  it("ignores a cleared mark whose block disappeared", () => {
    build(["a"]);
    const ui = mountDom(createElement(Harness, { marks: [mark("a"), mark("zz")] }));
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    expect(rules()).toBe("");
    ui.unmount();
  });

  it("removes its style element on unmount", () => {
    build(["a"]);
    const ui = mountDom(createElement(Harness, { marks: [] }));
    ui.rerender(createElement(Harness, { marks: [mark("a")] }));
    expect(rules()).not.toBe("");
    ui.unmount();
    expect(document.querySelector("style[data-enhance-rules]")).toBeNull();
  });
});
