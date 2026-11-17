// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToastProvider } from "~/components/ui/toast";
import { ChipsEditor } from "../components/editors/ChipsEditor";
import type { ComponentData } from "../components/kinds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const start: ComponentData = {
  fields: { label: "Quick links", layout: "inline" },
  items: [
    { label: "Handbook", href: "https://example.com", tone: "accent" },
    { label: "Wiki", href: "", tone: "neutral" },
  ],
};

let container: HTMLDivElement;
let root: Root;
const onSave = vi.fn();
const onClose = vi.fn();
function Harness() {
  const [draft, setDraft] = useState(start);
  return createElement(ChipsEditor, { draft, setDraft, onSave, onClose });
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

const chip = (i: number) => document.querySelectorAll<HTMLElement>(".dali-cmp-chip--edit")[i]!;
const openChip = (i: number) => click(chip(i).querySelector(".dali-cmp-chip__btn")!);

describe("ChipsEditor link popover", () => {
  it("opens portaled outside the block and named for the link", () => {
    mount();
    expect(pop()).toBeNull();
    openChip(0);
    expect(container.contains(pop())).toBe(false);
    expect(pop()!.getAttribute("aria-label")).toBe("Edit Handbook");
  });

  it("keeps it open with an error on an invalid link and closes once it is fixed", () => {
    mount();
    openChip(1);
    typeInto(popInput("https://"), "javascript:alert(1)");
    mousedown(document.body);
    expect(pop()!.querySelector('[role="alert"]')!.textContent).toContain("valid link");
    expect(popInput("https://").getAttribute("aria-invalid")).toBe("true");
    click(popButton("Save"));
    expect(pop()).not.toBeNull();
    typeInto(popInput("https://"), "https://example.com/wiki");
    click(popButton("Save"));
    expect(pop()).toBeNull();
  });

  it("closes on an outside press and applies edits", () => {
    mount();
    openChip(1);
    typeInto(popInput("Link name"), "Docs");
    mousedown(document.body);
    expect(pop()).toBeNull();
    expect(chip(1).textContent).toBe("Docs");
  });

  it("Escape reverts the edit and closes", () => {
    mount();
    openChip(1);
    typeInto(popInput("Link name"), "Docs");
    escape(popInput("Link name"));
    expect(pop()).toBeNull();
    expect(chip(1).textContent).toBe("Wiki");
  });

  it("Delete removes the link", () => {
    mount();
    openChip(1);
    click(popButton("Delete"));
    expect(pop()).toBeNull();
    expect(document.querySelectorAll(".dali-cmp-chip--edit")).toHaveLength(1);
  });

  it("stays open on a press inside it, on its own chip and in another floating layer", () => {
    mount();
    openChip(0);
    mousedown(popInput("Link name"));
    mousedown(chip(0).querySelector(".dali-cmp-chip__btn")!);
    const layer = otherLayer();
    mousedown(layer.btn);
    layer.remove();
    expect(pop()).not.toBeNull();
  });

  it("toggles closed from its own chip", () => {
    mount();
    openChip(0);
    mousedown(chip(0).querySelector(".dali-cmp-chip__btn")!);
    openChip(0);
    expect(pop()).toBeNull();
  });
});
