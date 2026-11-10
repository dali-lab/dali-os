// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RenderElement, RenderSlide } from "~/components/slides/deck/snapshot";

const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((e: { active: { id: string }; over: { id: string } | null }) => void) }));
vi.mock("@dnd-kit/core", async (orig) => {
  const actual = await orig<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (p: { onDragEnd: typeof dnd.onDragEnd; children: React.ReactNode }) => {
      dnd.onDragEnd = p.onDragEnd;
      return createElement("div", null, p.children);
    },
  };
});

import { BuildOrderPanel } from "../BuildOrderPanel";
import { Inspector } from "../Inspector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const text = (id: string, words: string, extra: Partial<RenderElement> = {}): RenderElement => ({
  id,
  kind: "text",
  slot: null,
  z: 1,
  blocks: [{ type: "paragraph", content: [{ type: "text", text: words, styles: {} }], children: [] }] as never,
  src: null,
  alt: null,
  textStyle: null,
  ...extra,
});
const slide = (elements: RenderElement[]): RenderSlide => ({ id: "s", pos: 1, layoutId: "blank", elements });
const rowIds = () => [...container.querySelectorAll("[data-build-row]")].map((r) => r.getAttribute("data-build-row"));
const click = (el: Element | null) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));

const base = slide([text("a", "First point", { build: 1 }), text("b", "Second point", { build: 1 }), text("c", "Third point", { build: 2, buildAfter: true, buildDelay: 500 }), text("n", "Always here")]);

function mount(over: Partial<React.ComponentProps<typeof BuildOrderPanel>> = {}) {
  const props = { slide: base, selection: [] as string[], editable: true, onEffect: vi.fn(), onSelect: vi.fn(), ...over, onApply: vi.fn() };
  act(() => root.render(createElement(BuildOrderPanel, props)));
  return props;
}

describe("BuildOrderPanel", () => {
  it("lists built items in order with their labels, step headings and grouping", () => {
    mount();
    expect(rowIds()).toEqual(["a", "b", "c"]);
    expect(container.textContent).toContain("First point");
    expect(container.textContent).not.toContain("Always here");
    expect([...container.querySelectorAll("[data-build-row]")].map((r) => r.getAttribute("data-build-mode"))).toEqual(["click", "with", "after"]);
    expect(container.textContent).toContain("Step 2, after previous");
  });

  it("says so when nothing builds", () => {
    mount({ slide: slide([text("n", "x")]) });
    expect(container.textContent).toContain("Nothing builds on this slide");
  });

  it("renumbers the whole order when a row is dragged", () => {
    const props = mount();
    act(() => dnd.onDragEnd!({ active: { id: "a" }, over: { id: "c" } }));
    const patches = props.onApply.mock.calls[0][0];
    expect([patches.b.build, patches.c.build, patches.a.build]).toEqual([1, 2, 3]);
    expect(patches.c).toMatchObject({ buildAfter: true, buildDelay: 500 });
  });

  it("ignores a drop on itself or outside the list", () => {
    const props = mount();
    act(() => dnd.onDragEnd!({ active: { id: "a" }, over: { id: "a" } }));
    act(() => dnd.onDragEnd!({ active: { id: "a" }, over: null }));
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("removes an item from builds and renumbers the rest", () => {
    const props = mount();
    click(container.querySelector("[aria-label='Remove First point from builds']"));
    const patches = props.onApply.mock.calls[0][0];
    expect(patches.a).toMatchObject({ build: null, buildAfter: false, buildBullets: false });
    expect(patches.b.build).toBe(1);
    expect(patches.c.build).toBe(2);
  });

  it("selects the element when its row is clicked and marks the selected row", () => {
    const props = mount({ selection: ["b"] });
    click(container.querySelector("[aria-label='Select Third point']"));
    expect(props.onSelect).toHaveBeenCalledWith(["c"]);
    expect(container.querySelector("[data-build-row='b']")!.getAttribute("aria-current")).toBe("true");
    expect(container.querySelector("[data-build-row='a']")!.getAttribute("aria-current")).toBeNull();
  });

  it("shows a delay field only for after previous rows and sends the change in milliseconds", () => {
    const props = mount();
    expect(container.querySelectorAll("input[type=number]")).toHaveLength(1);
    const input = container.querySelector<HTMLInputElement>("input[aria-label='Delay Third point']")!;
    expect(input.value).toBe("0.5");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(props.onApply.mock.calls[0][0].c).toMatchObject({ buildAfter: true, buildDelay: 2000 });
  });

  it("is read only when the deck is", () => {
    mount({ editable: false });
    expect(container.querySelector("[aria-label^='Remove']")).toBeNull();
    expect(container.querySelectorAll("[role=combobox], button[aria-haspopup]")).toHaveLength(0);
  });
});

describe("Inspector builds section", () => {
  const inspector = (selection: string[], onSelect = vi.fn()) =>
    act(() =>
      root.render(
        createElement(Inspector, {
          slide: base,
          themeId: "dali-dark",
          slideCount: 1,
          selection,
          editable: true,
          onLayout: vi.fn(),
          onTheme: vi.fn(),
          onTextStyle: vi.fn(),
          onPickImage: vi.fn(),
          onClearImage: vi.fn(),
          onBuildPlan: vi.fn(),
          onBuildEffect: vi.fn(),
          onSelect,
        }),
      ),
    );

  it("stays on the Slide tab when a build row is clicked, but a stage click still opens the element tab", () => {
    const onSelect = vi.fn();
    inspector([], onSelect);
    expect(container.querySelector("[aria-label='Build order']")).not.toBeNull();
    click(container.querySelector("[aria-label='Select First point']"));
    expect(onSelect).toHaveBeenCalledWith(["a"]);
    inspector(["a"], onSelect);
    expect(container.querySelector("[aria-label='Build order']")).not.toBeNull();
    inspector(["b"], onSelect);
    expect(container.querySelector("[aria-label='Build order']")).toBeNull();
  });
});
