// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToastProvider } from "~/components/ui/toast";
import { FeatureEditor } from "../components/editors/FeatureEditor";
import type { ComponentData } from "../components/kinds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const start: ComponentData = {
  fields: { eyebrow: "New", title: "Spring show", body: "", tone: "warning", image: "", cta: "Open", href: "https://example.com" },
  items: [],
};

let container: HTMLDivElement;
let root: Root;
const onSave = vi.fn();
const onClose = vi.fn();
function Harness() {
  const [draft, setDraft] = useState(start);
  return createElement(FeatureEditor, { draft, setDraft, onSave, onClose });
}
function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(ToastProvider, null, createElement(Harness))));
}
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  onSave.mockReset();
  onClose.mockReset();
});

const q = <T extends Element>(sel: string) => container.querySelector<T>(sel)!;
const click = (el: Element) => act(() => (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
const pop = () => document.querySelector<HTMLElement>("[role='dialog']");
const mousedown = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true, button: 0 })));
const escape = (el: Element = document.body) => act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
const typeInto = (el: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const popInput = (placeholder: string) => pop()!.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
const popButton = (text: string) => [...pop()!.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.trim() === text)!;
function otherLayer() {
  const layer = document.createElement("div");
  layer.setAttribute("data-floating-ui-portal", "");
  const btn = document.createElement("button");
  layer.appendChild(btn);
  document.body.appendChild(layer);
  return { btn, remove: () => layer.remove() };
}

const openButtonPop = () => click(q(".dali-cmp-feature-edit__cta .dali-cmp-cta"));

describe("FeatureEditor button popover", () => {
  it("opens portaled outside the block with the Button label", () => {
    mount();
    expect(pop()).toBeNull();
    openButtonPop();
    expect(container.contains(pop())).toBe(false);
    expect(pop()!.getAttribute("aria-label")).toBe("Button");
  });

  it("keeps it open with an error on an invalid URL, from an outside press or Save", () => {
    mount();
    openButtonPop();
    typeInto(popInput("https://..."), "javascript:alert(1)");
    mousedown(document.body);
    expect(pop()!.querySelector('[role="alert"]')!.textContent).toContain("valid link");
    click(popButton("Save"));
    expect(pop()).not.toBeNull();
    typeInto(popInput("https://..."), "https://example.com/show");
    click(popButton("Save"));
    expect(pop()).toBeNull();
  });

  it("Escape closes it without leaving the editor", () => {
    mount();
    openButtonPop();
    escape(popInput("Open"));
    expect(pop()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("applies the button text and Remove clears the button", () => {
    mount();
    openButtonPop();
    typeInto(popInput("Open"), "Get tickets");
    mousedown(document.body);
    expect(q(".dali-cmp-cta").textContent).toBe("Get tickets");
    openButtonPop();
    click(popButton("Remove"));
    expect(pop()).toBeNull();
    expect(container.querySelector(".dali-cmp-cta")).toBeNull();
  });

  it("stays open on a press inside it, on its button and in another floating layer", () => {
    mount();
    openButtonPop();
    mousedown(popInput("Open"));
    mousedown(q(".dali-cmp-cta"));
    const layer = otherLayer();
    mousedown(layer.btn);
    layer.remove();
    expect(pop()).not.toBeNull();
  });
});
