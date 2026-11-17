// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToastProvider } from "~/components/ui/toast";
import { CollectionEditor } from "../components/editors/CollectionEditor";
import type { ComponentData } from "../components/kinds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const start: ComponentData = {
  fields: { title: "Toolkit", categories: "Design" },
  items: [{ title: "Figma", description: "", category: "Design", icon: "palette", href: "https://www.figma.com" }],
};

let container: HTMLDivElement;
let root: Root;
const onSave = vi.fn();
const onClose = vi.fn();
function Harness() {
  const [draft, setDraft] = useState(start);
  return createElement(CollectionEditor, { draft, setDraft, onSave, onClose });
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
const button = (label: string) => all("button").find((b) => b.textContent?.trim() === label)!;
const chips = () => all(".dali-cmp-coll__chip--edit").map((c) => c.textContent?.trim());

describe("CollectionEditor", () => {
  it("adds a category and offers it to resources", () => {
    mount();
    type(q<HTMLInputElement>('input[aria-label="New category"]'), "Development");
    act(() => q("input[aria-label='New category']").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(chips()).toEqual(["Design", "Development"]);
    click(button("Add resource"));
    expect(all("datalist option").map((o) => (o as HTMLOptionElement).value)).toEqual(["Design", "Development"]);
  });

  it("ignores a duplicate category and strips commas", () => {
    mount();
    const input = q<HTMLInputElement>('input[aria-label="New category"]');
    type(input, "design");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    type(input, "A,B");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(chips()).toEqual(["Design", "A B"]);
  });

  it("adds a resource, and the new category joins the list", () => {
    mount();
    click(button("Add resource"));
    expect(all(".dali-cmp-coll__form button").find((b) => b.textContent === "Add resource")!.hasAttribute("disabled")).toBe(true);
    type(q<HTMLInputElement>('.dali-cmp-coll__form input[placeholder="https://..."]'), "https://example.com");
    type(q<HTMLInputElement>('.dali-cmp-coll__form input[placeholder="e.g. Figma"]'), "Example");
    type(q<HTMLInputElement>('.dali-cmp-coll__form input[list]'), "Writing");
    click(all(".dali-cmp-coll__form button").find((b) => b.textContent === "Add resource")!);
    expect(all(".dali-cmp-coll__open").map((b) => b.getAttribute("aria-label"))).toEqual(["Edit Figma", "Edit Example"]);
    expect(chips()).toEqual(["Design", "Writing"]);
  });

  it("refuses a link that isn't safe", () => {
    mount();
    click(button("Add resource"));
    type(q<HTMLInputElement>('.dali-cmp-coll__form input[placeholder="https://..."]'), "javascript:alert(1)");
    type(q<HTMLInputElement>('.dali-cmp-coll__form input[placeholder="e.g. Figma"]'), "Bad");
    click(all(".dali-cmp-coll__form button").find((b) => b.textContent === "Add resource")!);
    expect(q('[role="alert"]').textContent).toContain("valid link");
    expect(all(".dali-cmp-coll__open")).toHaveLength(1);
  });

  it("removing a category clears it from resources", () => {
    mount();
    click(q('[aria-label="Remove category Design"]'));
    expect(chips()).toEqual([]);
    click(button("Done"));
    expect(onSave.mock.calls[0]![0].fields.categories).toBe("");
    expect(onSave.mock.calls[0]![0].items[0].category).toBe("");
  });

  it("saves the title, categories and resources on Done", () => {
    mount();
    type(q<HTMLInputElement>('input[aria-label="Section title"]'), "Library");
    click(button("Done"));
    expect(onSave).toHaveBeenCalledWith({ fields: { title: "Library", categories: "Design" }, items: start.items });
  });

  it("deletes a resource and cancels without saving", () => {
    mount();
    click(q('[aria-label="Delete Figma"]'));
    expect(all(".dali-cmp-coll__open")).toHaveLength(0);
    click(button("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
