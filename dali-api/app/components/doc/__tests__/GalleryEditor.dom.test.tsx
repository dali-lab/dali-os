// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToastProvider } from "~/components/ui/toast";
import { GalleryEditor } from "../components/editors/GalleryEditor";
import type { ComponentData } from "../components/kinds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const start: ComponentData = {
  fields: { title: "From the lab", subtitle: "" },
  items: [
    { image: "", title: "One", byline: "Ada", tone: "accent", href: "" },
    { image: "", title: "Two", byline: "", tone: "success", href: "" },
  ],
};

let container: HTMLDivElement;
let root: Root;
const onSave = vi.fn();
const onClose = vi.fn();

function Harness() {
  const [draft, setDraft] = useState(start);
  return createElement(GalleryEditor, { draft, setDraft, onSave, onClose });
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
const type = (el: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const select = (i: number) => act(() => all(".dali-cmp-piece--edit")[i]!.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
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
const titles = () => all(".dali-cmp-row__title.dali-cmp-piece__titlefield").map((i) => (i as HTMLInputElement).value);
function otherLayer() {
  const layer = document.createElement("div");
  layer.setAttribute("data-floating-ui-portal", "");
  const btn = document.createElement("button");
  layer.appendChild(btn);
  document.body.appendChild(layer);
  return { btn, remove: () => layer.remove() };
}
const popButton = (text: string) => [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === text)!;
const linkInput = () => document.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder="https://..."]')!;

describe("GalleryEditor", () => {
  it("keeps the gallery visible with one editable title per tile and no form rows", () => {
    mount();
    expect(titles()).toEqual(["One", "Two"]);
    expect(pop()).toBeNull();
    expect(container.textContent).toContain("Add piece");
  });

  it("edits a tile title in place", () => {
    mount();
    type(all(".dali-cmp-row__title.dali-cmp-piece__titlefield")[1] as HTMLInputElement, "Second");
    expect(titles()).toEqual(["One", "Second"]);
  });

  it("selects one tile at a time and reveals its controls", () => {
    mount();
    select(0);
    expect(document.querySelectorAll("[role='dialog']")).toHaveLength(1);
    expect(all(".dali-cmp-piece--selected")).toHaveLength(1);
    select(1);
    expect(document.querySelectorAll("[role='dialog']")).toHaveLength(1);
    expect(all(".dali-cmp-piece--selected")[0]).toBe(all(".dali-cmp-piece--edit")[1]);
  });

  it("edits the credit inline and sets color from the popover", () => {
    mount();
    select(0);
    type(q<HTMLInputElement>('input[aria-label="Piece 1 credit"]'), "Grace");
    click(document.querySelector('[role="dialog"] [aria-label="danger"]')!);
    expect(document.querySelector('[role="dialog"] [aria-label="danger"]')!.getAttribute("aria-checked")).toBe("true");
    expect(q<HTMLInputElement>('input[aria-label="Piece 1 credit"]').value).toBe("Grace");
  });

  it("offers an Upload and a Link tab for the image, with no credit field in the popover", () => {
    mount();
    select(0);
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="dialog"] [role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(["Upload", "Link"]);
    expect(document.querySelector('[role="dialog"] input[placeholder="Paste an image link"]')).toBeNull();
    click([...document.querySelectorAll<HTMLElement>('[role="dialog"] [role="tab"]')][1]!);
    type(document.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder="Paste an image link"]')!, "https://example.com/a.png");
    expect(document.querySelector('[role="dialog"] input[placeholder="Who made this?"]')).toBeNull();
  });

  it("adds a piece as a new selected tile", () => {
    mount();
    click(q(".dali-cmp-piece--add"));
    expect(titles()).toHaveLength(3);
    expect(all(".dali-cmp-piece--selected")).toHaveLength(1);
  });

  it("deletes the selected tile", () => {
    mount();
    select(0);
    click(popButton("Delete"));
    expect(titles()).toEqual(["Two"]);
  });

  it("reorders with Alt+Arrow from the keyboard", () => {
    mount();
    act(() => all(".dali-cmp-piece--edit")[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true })));
    expect(titles()).toEqual(["Two", "One"]);
  });

  it("won't save a bad link and says why", () => {
    mount();
    select(0);
    type(linkInput(), "javascript:alert(1)");
    click(q(".dali-cmp-done"));
    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("valid link");
  });

  it("saves a good link and drops empty pieces", () => {
    mount();
    select(0);
    type(linkInput(), "https://example.com");
    click(q(".dali-cmp-piece--add"));
    click(q(".dali-cmp-done"));
    const saved = onSave.mock.calls[0]![0] as ComponentData;
    expect(saved.items.map((i) => i.title)).toEqual(["One", "Two"]);
    expect(saved.items[0]!.href).toBe("https://example.com");
  });

  it("Escape closes the controls and Cancel leaves without saving", () => {
    mount();
    select(0);
    act(() => all(".dali-cmp-piece--edit")[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(pop()).toBeNull();
    click(q(".dali-cmp-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("opens the piece popover portaled outside the block, named for the piece", () => {
    mount();
    select(0);
    expect(container.contains(pop())).toBe(false);
    expect(pop()!.getAttribute("aria-label")).toBe("Edit One");
  });

  it("keeps the piece selected on a press inside its popover or another floating layer, and deselects on an outside press", () => {
    mount();
    select(0);
    mousedown(pop()!.querySelector("[role=tab]")!);
    expect(all(".dali-cmp-piece--selected")).toHaveLength(1);
    const layer = otherLayer();
    mousedown(layer.btn);
    expect(pop()).not.toBeNull();
    layer.remove();
    mousedown(document.body);
    expect(pop()).toBeNull();
    expect(all(".dali-cmp-piece--selected")).toHaveLength(0);
  });

  it("closes the popover on Escape from outside the piece and Done closes it too", () => {
    mount();
    select(0);
    escape();
    expect(pop()).toBeNull();
    select(1);
    click(popButton("Done"));
    expect(pop()).toBeNull();
  });
});
