// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { addHtml } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";
import { setCustomCodePaused } from "~/components/slides/deck/pause-custom-code";
import { snapshotDeck } from "~/components/slides/deck/snapshot";
import { PresentStage } from "../PresentStage";
import { useDeckRender } from "../useDeckRender";
import type { RenderSlide } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeResizeObserver {
  constructor(private cb: () => void) {}
  observe() {
    this.cb();
  }
  disconnect() {}
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  current = deck();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  localStorage.clear();
  setCustomCodePaused(false);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 1600 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 900 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function deck() {
  const doc = new Y.Doc();
  initDeck(doc);
  const a = addSlide(doc, "blank", null);
  const b = addSlide(doc, "blank", a);
  addHtml(doc, a, "<p>live</p>", { fill: true });
  return { themeId: "dali-dark", slides: snapshotDeck(doc).slides, notes: {}, ids: [a, b] };
}

let render: RenderSlide;
let current: ReturnType<typeof deck>;
function Harness({ onIndex, hasCustomCode = true }: { onIndex: (i: number) => void; hasCustomCode?: boolean }) {
  const r = useDeckRender(current);
  render = r.renderSlide;
  return createElement(PresentStage, { slideIds: r.slideIds, index: 0, onIndexChange: onIndex, renderSlide: r.renderSlide, hasCustomCode });
}

describe("presenting custom HTML", () => {
  it("runs the frame, and a click inside it does not advance the slide", () => {
    const onIndex = vi.fn();
    act(() => root.render(createElement(Harness, { onIndex })));
    const f = container.querySelector("iframe")!;
    expect(f).toBeTruthy();
    expect(f.style.pointerEvents).toBe("auto");
    act(() => void f.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onIndex).not.toHaveBeenCalled();
    act(() => void container.querySelector<HTMLElement>("[data-testid=present-slide]")!.click());
    expect(onIndex).toHaveBeenCalledWith(1);
  });

  it("pauses and resumes from the control, which stays off by default", () => {
    act(() => root.render(createElement(Harness, { onIndex: vi.fn() })));
    const toggle = () => [...container.querySelectorAll("button")].find((b) => /custom code/.test(b.textContent ?? ""))!;
    expect(toggle().textContent).toBe("Pause custom code");
    act(() => void toggle().click());
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Custom code paused");
    expect(toggle().textContent).toBe("Resume custom code");
    act(() => void toggle().click());
    expect(container.querySelector("iframe")).toBeTruthy();
  });

  it("leaves the control out of a deck with no custom HTML", () => {
    act(() => root.render(createElement(Harness, { onIndex: vi.fn(), hasCustomCode: false })));
    expect([...container.querySelectorAll("button")].some((b) => /custom code/.test(b.textContent ?? ""))).toBe(false);
  });

  it("draws a card, not a frame, in the presenter's filmstrip and next-slide previews", () => {
    act(() => root.render(createElement(Harness, { onIndex: vi.fn() })));
    const first = current.ids[0];
    const root2 = document.createElement("div");
    document.body.appendChild(root2);
    const r = createRoot(root2);
    act(() => r.render(render(first, { width: 300, thumb: true }) as never));
    expect(root2.querySelector("iframe")).toBeNull();
    expect(root2.textContent).toContain("Custom HTML");
    act(() => r.unmount());
    root2.remove();
  });
});
