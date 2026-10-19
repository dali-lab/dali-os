// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createElement, act } from "react";
import { mountDom } from "./test-support";
import { typedBlockIds, useEnhancingWash } from "./use-enhancing-wash";
import type { SnapshotBlock } from "./enhance-plan";

const blocks: SnapshotBlock[] = [
  { id: "h", type: "heading", text: "Recruiting" },
  { id: "a", type: "paragraph", text: "typed one" },
  { id: "e", type: "paragraph", text: "  " },
  { id: "b", type: "bulletListItem", text: "typed two" },
];

let root: HTMLElement;

function Harness({ active }: { active: boolean }) {
  useEnhancingWash({ active, getRoot: () => root, getBlocks: () => blocks });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement("div");
  root.innerHTML = blocks.map((b) => `<div class="bn-block-outer" data-id="${b.id}"></div>`).join("");
  document.body.appendChild(root);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  for (const style of document.head.querySelectorAll("style[data-enhance-rules]")) style.remove();
});

const css = () => document.querySelector('style[data-enhance-rules="wash"]')?.textContent ?? "";
const washed = () => ["h", "a", "e", "b"].filter((id) => css().includes(`[data-id="${id}"]`));

describe("useEnhancingWash", () => {
  it("selects only non-empty, non-heading blocks", () => {
    expect(typedBlockIds(blocks)).toEqual(["a", "b"]);
  });

  it("washes typed blocks top to bottom only while generating, through a generated rule", () => {
    const ui = mountDom(createElement(Harness, { active: true }));
    expect(washed()).toEqual(["a"]);
    expect(css()).toContain("animation: enhance-wash-a 1100ms linear both");
    act(() => void vi.advanceTimersByTime(1100));
    expect(washed()).toEqual(["b"]);
    expect(css()).toContain("enhance-wash-b");
    act(() => void vi.advanceTimersByTime(1100));
    expect(washed()).toEqual(["a"]);
    ui.rerender(createElement(Harness, { active: false }));
    expect(document.querySelector("style[data-enhance-rules]")).toBeNull();
    ui.unmount();
  });

  it("never touches the editor's nodes", () => {
    const ui = mountDom(createElement(Harness, { active: true }));
    act(() => void vi.advanceTimersByTime(2200));
    expect(root.querySelectorAll("[data-enhance-wash], [style]")).toHaveLength(0);
    ui.unmount();
  });

  it("does nothing when not generating", () => {
    const ui = mountDom(createElement(Harness, { active: false }));
    expect(document.querySelector("style[data-enhance-rules]")).toBeNull();
    ui.unmount();
  });
});
