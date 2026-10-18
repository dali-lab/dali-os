// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createElement } from "react";
import { mountDom } from "./test-support";
import { typedBlockIds, useEnhancingWash, WASH_ATTR } from "./use-enhancing-wash";
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
});

const attr = (id: string) => root.querySelector(`[data-id="${id}"]`)!.getAttribute(WASH_ATTR);

describe("useEnhancingWash", () => {
  it("selects only non-empty, non-heading blocks", () => {
    expect(typedBlockIds(blocks)).toEqual(["a", "b"]);
  });

  it("washes typed blocks top to bottom only while generating", () => {
    const ui = mountDom(createElement(Harness, { active: true }));
    expect(attr("h")).toBeNull();
    expect(attr("e")).toBeNull();
    expect([attr("a"), attr("b")]).toEqual(["active", ""]);
    vi.advanceTimersByTime(1100);
    expect([attr("a"), attr("b")]).toEqual(["", "active"]);
    vi.advanceTimersByTime(1100);
    expect(attr("a")).toBe("active");
    ui.rerender(createElement(Harness, { active: false }));
    expect(root.querySelectorAll(`[${WASH_ATTR}]`)).toHaveLength(0);
    ui.unmount();
  });

  it("does nothing when not generating", () => {
    const ui = mountDom(createElement(Harness, { active: false }));
    expect(root.querySelectorAll(`[${WASH_ATTR}]`)).toHaveLength(0);
    ui.unmount();
  });
});
