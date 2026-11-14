// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToastProvider } from "~/components/ui/toast";
import { GalleryEditor } from "../schema/component";
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
const titles = () => all(".dali-cmp-row__title.dali-cmp-piece__titlefield").map((i) => (i as HTMLInputElement).value);
const linkInput = () => q<HTMLInputElement>('.dali-cmp-piece__pop input[aria-label="Opens"], .dali-cmp-piece__pop label input[placeholder="https://..."]');

describe("GalleryEditor", () => {
  it("keeps the gallery visible with one editable title per tile and no form rows", () => {
    mount();
    expect(titles()).toEqual(["One", "Two"]);
    expect(container.querySelector(".dali-cmp-piece__pop")).toBeNull();
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
    expect(all(".dali-cmp-piece__pop")).toHaveLength(1);
    expect(all(".dali-cmp-piece--selected")).toHaveLength(1);
    select(1);
    expect(all(".dali-cmp-piece__pop")).toHaveLength(1);
    expect(all(".dali-cmp-piece--selected")[0]).toBe(all(".dali-cmp-piece--edit")[1]);
  });

  it("edits the credit inline and sets color from the popover", () => {
    mount();
    select(0);
    type(q<HTMLInputElement>('input[aria-label="Piece 1 credit"]'), "Grace");
    click(q('.dali-cmp-piece__pop [aria-label="danger"]'));
    expect(q('.dali-cmp-piece__pop [aria-label="danger"]').getAttribute("aria-checked")).toBe("true");
    expect(q<HTMLInputElement>('input[aria-label="Piece 1 credit"]').value).toBe("Grace");
  });

  it("offers an Upload and a Link tab for the image, with no credit field in the popover", () => {
    mount();
    select(0);
    const tabs = all('.dali-cmp-piece__pop [role="tab"]').map((t) => t.textContent);
    expect(tabs).toEqual(["Upload", "Link"]);
    expect(container.querySelector('.dali-cmp-piece__pop input[aria-label="Image link"]')).toBeNull();
    click(all('.dali-cmp-piece__pop [role="tab"]')[1]!);
    type(q<HTMLInputElement>('.dali-cmp-piece__pop input[aria-label="Image link"]'), "https://example.com/a.png");
    expect(container.querySelector('.dali-cmp-piece__pop input[placeholder="Who made this?"]')).toBeNull();
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
    click(q(".dali-cmp-pop-delete"));
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
    expect(q('[role="alert"]').textContent).toContain("valid link");
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
    expect(container.querySelector(".dali-cmp-piece__pop")).toBeNull();
    click(q(".dali-cmp-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
