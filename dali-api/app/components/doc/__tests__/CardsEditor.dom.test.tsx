// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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
const titles = () => all(".dali-cmp-card__title").map((i) => (i as HTMLInputElement).value);

describe("CardsEditor", () => {
  it("shows no swatches, palette or link controls until a card is selected", () => {
    mount();
    expect(container.querySelector(".dali-cmp-card__palette")).toBeNull();
    expect(container.querySelector('[aria-label="Card 1 color"]')).toBeNull();
    expect(container.querySelector(".dali-cmp-swatch")).toBeNull();
  });

  it("opens a compact color popover from the palette icon and marks the current color", () => {
    mount();
    select(0);
    click(q('[aria-label="Card 1 color"]'));
    const swatches = all(".dali-cmp-card__palette [role=radio]");
    expect(swatches).toHaveLength(5);
    expect(swatches.filter((s) => s.getAttribute("aria-checked") === "true").map((s) => s.getAttribute("aria-label"))).toEqual(["accent"]);
    click(q('.dali-cmp-card__palette [aria-label="danger"]'));
    expect(container.querySelector(".dali-cmp-card__palette")).toBeNull();
    expect(all(".dali-cmp-card--edit")[0]!.className).toContain("dali-cmp-tone--danger");
  });

  it("keeps the link behind an icon and edits it inline", () => {
    mount();
    select(0);
    expect(container.querySelector('input[aria-label="Card 1 link"]')).toBeNull();
    click(q('[aria-label="Add link to card 1"]'));
    expect(q<HTMLInputElement>('input[aria-label="Card 1 link"]').placeholder).toBe("https://...");
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
