// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToastProvider } from "~/components/ui/toast";
import { CardsEditor } from "../components/editors/CardsEditor";
import type { ComponentData } from "../components/kinds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const start: ComponentData = {
  fields: { title: "This term" },
  items: [
    { tag: "Now", title: "Kickoff", meta: "Week 1", tone: "accent", href: "" },
    { tag: "", title: "Crit", meta: "", tone: "success", href: "https://example.com" },
  ],
};

let container: HTMLDivElement;
let root: Root;
const onSave = vi.fn();
const onClose = vi.fn();
function Harness() {
  const [draft, setDraft] = useState(start);
  return createElement(CardsEditor, { draft, setDraft, onSave, onClose });
}
function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(ToastProvider, null, createElement(Harness))));
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  onSave.mockReset();
  onClose.mockReset();
});

const q = <T extends Element>(sel: string) => container.querySelector<T>(sel)!;
const all = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];
const click = (el: Element) => act(() => (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
const select = (i: number) => click(all(".dali-cmp-card--edit")[i]!);
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
const pop = () => document.querySelector<HTMLElement>("[role='dialog']");
const mousedown = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true, button: 0 })));
const escape = (el: Element = document.body) => act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
const typeInto = (el: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
function otherLayer() {
  const layer = document.createElement("div");
  layer.setAttribute("data-floating-ui-portal", "");
  const btn = document.createElement("button");
  layer.appendChild(btn);
  document.body.appendChild(layer);
  return { btn, remove: () => layer.remove() };
}
const titles = () => all(".dali-cmp-card__title").map((i) => (i as HTMLInputElement).value);

describe("CardsEditor", () => {
  it("shows no swatches, palette or link controls until a card is selected", () => {
    mount();
    expect(container.querySelector(".dali-cmp-card__palette")).toBeNull();
    expect(container.querySelector('[aria-label="Card 1 color"]')).toBeNull();
    expect(container.querySelector(".dali-cmp-swatch")).toBeNull();
  });

  it("opens the color palette in a portaled, named popover and marks the current color", () => {
    mount();
    select(0);
    click(q('[aria-label="Card 1 color"]'));
    expect(container.contains(pop())).toBe(false);
    expect(pop()!.getAttribute("aria-label")).toBe("Card 1 color");
    const swatches = [...pop()!.querySelectorAll<HTMLElement>("[role=radio]")];
    expect(swatches).toHaveLength(5);
    expect(swatches.filter((s) => s.getAttribute("aria-checked") === "true").map((s) => s.getAttribute("aria-label"))).toEqual(["accent"]);
    click(pop()!.querySelector('[aria-label="danger"]')!);
    expect(pop()).toBeNull();
    expect(all(".dali-cmp-card--edit")[0]!.className).toContain("dali-cmp-tone--danger");
  });

  it("opens the link field in a portaled, named popover", () => {
    mount();
    select(0);
    expect(pop()).toBeNull();
    click(q('[aria-label="Add link to card 1"]'));
    expect(container.contains(pop())).toBe(false);
    expect(pop()!.getAttribute("aria-label")).toBe("Card 1 link");
    expect(pop()!.querySelector<HTMLInputElement>("input")!.placeholder).toBe("https://...");
  });

  it("keeps the link popover open with an error on a bad link, and closes on a good one", () => {
    mount();
    select(0);
    click(q('[aria-label="Add link to card 1"]'));
    typeInto(pop()!.querySelector("input")!, "javascript:alert(1)");
    mousedown(document.body);
    expect(pop()!.querySelector('[role="alert"]')!.textContent).toContain("valid link");
    expect(pop()!.querySelector("input")!.getAttribute("aria-invalid")).toBe("true");
    typeInto(pop()!.querySelector("input")!, "https://example.com");
    mousedown(document.body);
    expect(pop()).toBeNull();
    expect(q<HTMLInputElement>('[aria-label="Edit link for card 1"]')).not.toBeNull();
  });

  it("closes the link popover on Escape", () => {
    mount();
    select(0);
    click(q('[aria-label="Add link to card 1"]'));
    escape(pop()!.querySelector("input")!);
    expect(pop()).toBeNull();
  });

  it("keeps the card selected on a press inside its popover and when another floating layer is used", () => {
    mount();
    select(0);
    click(q('[aria-label="Card 1 color"]'));
    mousedown(pop()!.querySelector("[role=radio]")!);
    expect(all(".dali-cmp-card--selected")).toHaveLength(1);
    const layer = otherLayer();
    mousedown(layer.btn);
    expect(pop()).not.toBeNull();
    expect(all(".dali-cmp-card--selected")).toHaveLength(1);
    layer.remove();
    mousedown(document.body);
    expect(all(".dali-cmp-card--selected")).toHaveLength(0);
  });

  it("opens one popover at a time and the trigger toggles it without an outside press", () => {
    mount();
    select(0);
    click(q('[aria-label="Card 1 color"]'));
    click(q('[aria-label="Add link to card 1"]'));
    expect(document.querySelectorAll("[role='dialog']")).toHaveLength(1);
    expect(pop()!.getAttribute("aria-label")).toBe("Card 1 link");
    mousedown(q('[aria-label="Add link to card 1"]'));
    expect(pop()).not.toBeNull();
    click(q('[aria-label="Add link to card 1"]'));
    expect(pop()).toBeNull();
  });

  it("adds a card with a pastel color, selects it and focuses its title", () => {
    mount();
    click(q(".dali-cmp-card--add"));
    expect(titles()).toHaveLength(3);
    expect(all(".dali-cmp-card--edit")[2]!.className).toContain("dali-cmp-tone--warning");
    expect(document.activeElement).toBe(all(".dali-cmp-card__title")[2]);
  });

  it("deletes a card from its corner control", () => {
    mount();
    click(q('[aria-label="Delete card 1"]'));
    expect(titles()).toEqual(["Crit"]);
  });

  it("Done saves without empty cards; Cancel leaves", () => {
    mount();
    click(q(".dali-cmp-card--add"));
    click(q(".dali-cmp-done"));
    expect((onSave.mock.calls[0]![0] as ComponentData).items).toHaveLength(2);
    click(q(".dali-cmp-cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});
