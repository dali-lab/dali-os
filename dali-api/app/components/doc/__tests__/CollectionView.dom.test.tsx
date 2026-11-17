// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CollectionView } from "../components/CollectionView";
import type { ComponentData } from "../components/kinds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/Modal", () => ({
  Modal: ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) =>
    createElement("div", { role: "dialog" }, createElement("button", { onClick: onClose, "aria-label": "Close" }), children),
  ModalHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => createElement("div", null, createElement("h2", null, title), actions),
}));

const data: ComponentData = {
  fields: { title: "Toolkit", categories: "Design, Development", open: "1" },
  items: [
    { title: "Figma", description: "Design files", category: "Design", icon: "palette", href: "https://www.figma.com" },
    { title: "MDN", description: "Web docs", category: "Development", icon: "code", href: "https://developer.mozilla.org" },
    { title: "Handbook", description: "", category: "", icon: "book", href: "/resources" },
    { title: "No link", description: "", category: "Design", icon: "link", href: "" },
  ],
};

let container: HTMLDivElement;
let root: Root;
function mount(d: ComponentData = data) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(CollectionView, d)));
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const tiles = () => [...container.querySelectorAll(".dali-cmp-coll__name")].map((n) => n.textContent);
const click = (el: Element) => act(() => (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
const chip = (label: string) => [...container.querySelectorAll<HTMLButtonElement>(".dali-cmp-coll__chip")].find((b) => b.textContent === label)!;

describe("CollectionView", () => {
  it("lists every resource under an All filter plus the categories", () => {
    mount();
    expect(tiles()).toEqual(["Figma", "MDN", "Handbook", "No link"]);
    expect([...container.querySelectorAll(".dali-cmp-coll__chip")].map((b) => b.textContent)).toEqual(["All", "Design", "Development"]);
    expect(chip("All").getAttribute("aria-pressed")).toBe("true");
  });

  it("filters tiles by category and back to all", () => {
    mount();
    click(chip("Design"));
    expect(tiles()).toEqual(["Figma", "No link"]);
    expect(chip("Design").getAttribute("aria-pressed")).toBe("true");
    click(chip("All"));
    expect(tiles()).toHaveLength(4);
  });

  it("hides the filter bar when there are no categories", () => {
    mount({ fields: { title: "Plain", categories: "" }, items: [{ title: "A", href: "https://a.example" }] });
    expect(container.querySelector(".dali-cmp-coll__filters")).toBeNull();
  });

  it("collapses and expands from the heading, and starts collapsed when told to", () => {
    mount();
    const head = container.querySelector<HTMLButtonElement>(".dali-cmp-coll__head")!;
    expect(head.getAttribute("aria-expanded")).toBe("true");
    click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".dali-cmp-coll--open")).toBeNull();
    click(head);
    expect(container.querySelector(".dali-cmp-coll--open")).not.toBeNull();
    act(() => root.unmount());
    container.remove();
    mount({ ...data, fields: { ...data.fields, open: "0" } });
    expect(container.querySelector(".dali-cmp-coll__head")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a resource in an overlay instead of navigating, and closes it", () => {
    mount();
    const link = container.querySelector<HTMLAnchorElement>("a.dali-cmp-coll__tile")!;
    click(link);
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Figma");
    expect(dialog.querySelector('a[href="https://www.figma.com"]')?.getAttribute("target")).toBe("_blank");
    click(dialog.querySelector('[aria-label="Close"]')!);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("embeds internal pages and falls back to an info card for external sites", () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ image: null, title: "Mozilla", description: "Docs" }) })));
    mount();
    click([...container.querySelectorAll("a.dali-cmp-coll__tile")][2]!);
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe("/resources");
    vi.unstubAllGlobals();
  });

  it("never renders a frame for an external site", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ image: null, title: null, description: null }) })));
    mount();
    await act(async () => {
      click([...container.querySelectorAll("a.dali-cmp-coll__tile")][1]!);
    });
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("can't be shown here");
    vi.unstubAllGlobals();
  });

  it("renders a tile without a link as plain content, not a link", () => {
    mount();
    const noLink = [...container.querySelectorAll(".dali-cmp-coll__tile")].find((t) => t.textContent?.includes("No link"))!;
    expect(noLink.tagName).toBe("DIV");
  });
});
