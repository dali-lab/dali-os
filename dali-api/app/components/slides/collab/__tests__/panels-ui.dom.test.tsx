// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import { EditorToolbar as RealToolbar } from "../EditorToolbar";
import { Inspector as RealInspector } from "../Inspector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("EditorToolbar panel controls", () => {
  const base = { canUndo: true, canRedo: true, onUndo: vi.fn(), onRedo: vi.fn(), onAdd: vi.fn(), onInsert: vi.fn(), onGrid: vi.fn() };
  const render = (extra: object) => (act(() => root.render(createElement(RealToolbar, { ...base, ...extra }))), container);
  const labels = () => [...container.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());

  it("has a panel button at the right end that says what it will do", () => {
    const onToggleInspector = vi.fn();
    render({ onToggleInspector });
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons[buttons.length - 1].getAttribute("aria-label")).toBe("Hide panel");
    act(() => void buttons[buttons.length - 1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onToggleInspector).toHaveBeenCalledTimes(1);
    render({ onToggleInspector, inspectorHidden: true });
    expect(labels()).toContain("Show panel");
  });

  it("keeps only undo, redo, Insert and Exit focus in focus mode", () => {
    const onExitFocus = vi.fn();
    render({ onToggleInspector: vi.fn(), focus: true, onExitFocus });
    expect(labels()).toEqual(["Undo", "Redo", "Insert", "Exit focus"]);
    act(() => void [...container.querySelectorAll("button")].at(-1)!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onExitFocus).toHaveBeenCalled();
  });
});

describe("Inspector tabs", () => {
  const slide: RenderSlide = { id: "s", pos: 0, layoutId: "content", elements: [] };
  const base = { slide, themeId: "dali-dark", slideCount: 1, selection: [], editable: true, onLayout: vi.fn(), onTheme: vi.fn(), onTextStyle: vi.fn(), onPickImage: vi.fn(), onClearImage: vi.fn() };
  const render = (extra: object = {}) => (act(() => root.render(createElement(RealInspector, { ...base, ...extra }))), container);
  const tab = (name: string) => [...container.querySelectorAll("[aria-label='Inspector'] button")].find((b) => b.textContent === name)!;

  it("shows the theme only on the Deck tab", () => {
    render();
    expect(container.querySelector("[aria-label='Theme']")).toBeNull();
    act(() => void tab("Deck").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelector("[aria-label='Theme']")).not.toBeNull();
  });

  it("jumps to the item tab when asked, and not just because it was mounted with a request", () => {
    render({ tabRequest: 3 });
    expect(container.querySelector("[aria-label='Layouts']")).not.toBeNull();
    render({ tabRequest: 4 });
    expect(container.querySelector("[aria-label='Layouts']")).toBeNull();
  });
});

