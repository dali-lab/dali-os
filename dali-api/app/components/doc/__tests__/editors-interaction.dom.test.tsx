// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement, useState, type ComponentType } from "react";
import { ToastProvider } from "~/components/ui/toast";
import { renderDom, click, typeInto } from "~/test-utils/render";
import { CardsEditor } from "../components/editors/CardsEditor";
import { StatsEditor } from "../components/editors/StatsEditor";
import { TimelineEditor } from "../components/editors/TimelineEditor";
import { GalleryEditor } from "../components/editors/GalleryEditor";
import { LinksEditor } from "../components/editors/LinksEditor";
import { CollectionEditor } from "../components/editors/CollectionEditor";
import { CollectionView } from "../components/CollectionView";
import { ITEM_DRAG_MIME } from "../components/editors/reorder";
import type { ComponentData } from "../components/kinds";

vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: async () => true }) }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame;
});

type Editor = ComponentType<{ draft: ComponentData; setDraft: React.Dispatch<React.SetStateAction<ComponentData>>; onSave: (d: ComponentData) => void; onClose: () => void }>;

function mount(Editor: Editor, start: ComponentData) {
  const onSave = vi.fn();
  function Harness() {
    const [draft, setDraft] = useState(start);
    return createElement(Editor, { draft, setDraft, onSave, onClose: vi.fn() });
  }
  const view = renderDom(createElement(ToastProvider, null, createElement(Harness)));
  return { ...view, onSave };
}

const alt = (el: Element, key: string) =>
  act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key, altKey: true, bubbles: true, cancelable: true })));
const dragStart = (el: Element) => {
  const setData = vi.fn();
  const ev = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.assign(ev, { dataTransfer: { setData, effectAllowed: "" } });
  act(() => void el.dispatchEvent(ev));
  return setData;
};
const mouseDown = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
const values = (c: HTMLElement, sel: string) => [...c.querySelectorAll<HTMLInputElement>(sel)].map((i) => i.value);
const byLabel = (c: ParentNode, label: string | RegExp) =>
  [...c.querySelectorAll<HTMLElement>("[aria-label]")].find((e) => (typeof label === "string" ? e.getAttribute("aria-label") === label : label.test(e.getAttribute("aria-label")!)))!;

const cards: ComponentData = { fields: { title: "T" }, items: [{ title: "One", tone: "accent" }, { title: "Two", tone: "success" }, { title: "Three" }] };
const stats: ComponentData = { fields: {}, items: [{ value: "1", label: "A" }, { value: "2", label: "B" }] };
const timeline: ComponentData = { fields: { current: "2" }, items: [{ label: "A" }, { label: "B" }, { label: "C" }] };
const gallery: ComponentData = { fields: {}, items: [{ title: "One", tone: "accent" }, { title: "Two", tone: "success" }] };
const links: ComponentData = { fields: {}, items: [{ title: "One", href: "https://a.test" }, { title: "Two", href: "" }] };
const collection: ComponentData = { fields: { categories: "Tools" }, items: [{ title: "One", href: "https://a.test", icon: "link" }, { title: "Two", href: "https://b.test", icon: "link" }] };

describe("drag payload", () => {
  const cases: [string, Editor, ComponentData, string][] = [
    ["cards", CardsEditor, cards, ".dali-cmp-card--edit"],
    ["stats", StatsEditor, stats, ".dali-cmp-stat--edit"],
    ["timeline", TimelineEditor, timeline, ".dali-cmp-step:not(.dali-cmp-step--add)"],
    ["gallery", GalleryEditor, gallery, ".dali-cmp-piece--edit"],
    ["links", LinksEditor, links, ".dali-cmp-row--edit"],
    ["collection", CollectionEditor, collection, ".dali-cmp-coll__tile--edit"],
  ];
  it.each(cases)("%s uses a private type instead of text/plain", (_name, Editor, start, item) => {
    const { container } = mount(Editor, start);
    const setData = dragStart(container.querySelector(item)!);
    expect(setData).toHaveBeenCalledWith(ITEM_DRAG_MIME, "0");
    expect(setData).not.toHaveBeenCalledWith("text/plain", expect.anything());
  });
});

describe("Alt+Arrow reorder", () => {
  it("ignores Alt+Arrow typed in a card input and moves the card from its grip", () => {
    const { container } = mount(CardsEditor, cards);
    alt(byLabel(container, "Card 1 title"), "ArrowRight");
    expect(values(container, ".dali-cmp-card__title")).toEqual(["One", "Two", "Three"]);
    alt(byLabel(container, /^Reorder card 1/), "ArrowRight");
    expect(values(container, ".dali-cmp-card__title")).toEqual(["Two", "One", "Three"]);
  });

  it("ignores Alt+Arrow typed in a stat input", () => {
    const { container } = mount(StatsEditor, stats);
    alt(byLabel(container, "Stat 1 label"), "ArrowRight");
    expect(values(container, ".dali-cmp-stat__value")).toEqual(["1", "2"]);
  });

  it("ignores Alt+Arrow in a step name and moves the step from its number button", () => {
    const { container } = mount(TimelineEditor, timeline);
    alt(byLabel(container, "Step 1 name"), "ArrowRight");
    expect(values(container, ".dali-cmp-step__input")).toEqual(["A", "B", "C"]);
    alt(byLabel(container, "Step 1 options"), "ArrowRight");
    expect(values(container, ".dali-cmp-step__input")).toEqual(["B", "A", "C"]);
  });

  it("ignores Alt+Arrow in a piece input", () => {
    const { container } = mount(GalleryEditor, gallery);
    alt(byLabel(container, "Piece 1 title"), "ArrowRight");
    expect(values(container, ".dali-cmp-row__title")).toEqual(["One", "Two"]);
  });
});

describe("deleting an item", () => {
  it("does not select a neighbour when a card is deleted", () => {
    const { container } = mount(CardsEditor, cards);
    click(byLabel(container, "Delete card 2"));
    expect(container.querySelectorAll(".dali-cmp-card--selected")).toHaveLength(0);
    expect(values(container, ".dali-cmp-card__title")).toEqual(["One", "Three"]);
  });

  it("does not select a neighbour when a stat is deleted", () => {
    const { container } = mount(StatsEditor, stats);
    click(byLabel(container, "Delete stat 1"));
    expect(container.querySelectorAll(".dali-cmp-stat--selected")).toHaveLength(0);
  });
});

describe("cards drag handle", () => {
  it("is draggable only while the grip is held", () => {
    const { container } = mount(CardsEditor, cards);
    const card = container.querySelector<HTMLElement>(".dali-cmp-card--edit")!;
    expect(card.draggable).toBe(false);
    mouseDown(byLabel(container, /^Reorder card 1/));
    expect(card.draggable).toBe(true);
  });
});

describe("timeline current step", () => {
  const current = (c: HTMLElement) => [...c.querySelectorAll(".dali-cmp-step:not(.dali-cmp-step--add)")].findIndex((s) => s.classList.contains("dali-cmp-step--current")) + 1;

  it("follows its step when steps move", () => {
    const { container } = mount(TimelineEditor, timeline);
    alt(byLabel(container, "Step 2 options"), "ArrowLeft");
    expect(values(container, ".dali-cmp-step__input")).toEqual(["B", "A", "C"]);
    expect(current(container)).toBe(1);
    alt(byLabel(container, "Step 1 options"), "ArrowRight");
    expect(current(container)).toBe(2);
  });

  it("shifts when an earlier step moves past it", () => {
    const { container } = mount(TimelineEditor, timeline);
    alt(byLabel(container, "Step 1 options"), "ArrowRight");
    alt(byLabel(container, "Step 2 options"), "ArrowRight");
    expect(values(container, ".dali-cmp-step__input")).toEqual(["B", "C", "A"]);
    expect(current(container)).toBe(1);
  });

  it("follows its step when an earlier one is deleted", async () => {
    const { container } = mount(TimelineEditor, timeline);
    await act(async () => void byLabel(container, "Delete step 1").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(values(container, ".dali-cmp-step__input")).toEqual(["B", "C"]);
    expect(current(container)).toBe(1);
  });

  it("clears when the current step is deleted", async () => {
    const { container, onSave } = mount(TimelineEditor, timeline);
    await act(async () => void byLabel(container, "Delete step 2").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    click(container.querySelector(".dali-cmp-done")!);
    expect(onSave.mock.calls[0]![0].fields.current).toBe("");
  });

  it("follows its step when blank steps are dropped on Done", () => {
    const { container, onSave } = mount(TimelineEditor, { fields: { current: "3" }, items: [{ label: "" }, { label: "B" }, { label: "C" }] });
    click(container.querySelector(".dali-cmp-done")!);
    const saved = onSave.mock.calls[0]![0] as ComponentData;
    expect(saved.items.map((i) => i.label)).toEqual(["B", "C"]);
    expect(saved.fields.current).toBe("2");
  });
});

describe("Done with an open resource form", () => {
  const field = (c: ParentNode, label: string) => [...c.querySelectorAll<HTMLLabelElement>("label")].find((l) => l.textContent?.startsWith(label))!.querySelector("input")!;
  const open = (c: HTMLElement, label: string) => click([...c.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!);
  const done = (c: HTMLElement) => click(c.querySelector(".dali-cmp-done")!);

  it("links: applies a valid new resource", () => {
    const { container, onSave } = mount(LinksEditor, links);
    open(container, "Add resource");
    typeInto(field(container, "Link"), "https://c.test");
    typeInto(field(container, "Resource name"), "Three");
    done(container);
    expect(onSave.mock.calls[0]![0].items.map((i: Record<string, string>) => i.title)).toEqual(["One", "Two", "Three"]);
  });

  it("links: keeps the form open with an error when the open form is invalid", () => {
    const { container, onSave } = mount(LinksEditor, links);
    open(container, "Add resource");
    typeInto(field(container, "Resource name"), "Three");
    done(container);
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Add a link.");
  });

  it("links: ignores an empty form and still saves link-less rows", () => {
    const { container, onSave } = mount(LinksEditor, links);
    open(container, "Add resource");
    done(container);
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]![0].items).toHaveLength(2);
  });

  it("links: applies edits to an existing row", () => {
    const { container, onSave } = mount(LinksEditor, links);
    click(byLabel(container, "Edit One"));
    typeInto(field(container, "Resource name"), "Uno");
    done(container);
    expect(onSave.mock.calls[0]![0].items[0].title).toBe("Uno");
  });

  it("collection: applies a valid new resource and its new category", () => {
    const { container, onSave } = mount(CollectionEditor, collection);
    open(container, "Add resource");
    typeInto(field(container, "Link"), "https://c.test");
    typeInto(field(container, "Resource name"), "Three");
    typeInto(field(container, "Category"), "Reading");
    done(container);
    const saved = onSave.mock.calls[0]![0] as ComponentData;
    expect(saved.items.map((i) => i.title)).toEqual(["One", "Two", "Three"]);
    expect(saved.fields.categories).toBe("Tools, Reading");
  });

  it("collection: blocks Done on an invalid open form", () => {
    const { container, onSave } = mount(CollectionEditor, collection);
    open(container, "Add resource");
    typeInto(field(container, "Link"), "https://c.test");
    done(container);
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Add a resource name.");
  });

  it("collection: two open forms never share a datalist id", () => {
    const a = mount(CollectionEditor, collection);
    const b = mount(CollectionEditor, collection);
    open(a.container, "Add resource");
    open(b.container, "Add resource");
    const ids = [a.container, b.container].map((c) => c.querySelector("datalist")!.id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(field(a.container, "Category").getAttribute("list")).toBe(ids[0]);
  });
});

describe("collection view links", () => {
  const view = (href: string) => renderDom(createElement(CollectionView, { fields: { title: "T", open: "1" }, items: [{ title: "Tile", href }] }));
  const tile = (c: HTMLElement) => c.querySelector<HTMLAnchorElement>("a.dali-cmp-coll__tile")!;
  const press = (a: HTMLElement) => {
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    act(() => void a.dispatchEvent(ev));
    return ev.defaultPrevented;
  };

  it.each(["mailto:a@b.edu", "tel:+15551234567", "#section"])("follows %s directly", (href) => {
    const { container } = view(href);
    expect(press(tile(container))).toBe(false);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens web links in the overlay", () => {
    const { container } = view("https://example.com");
    expect(press(tile(container))).toBe(true);
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("gives each overlay its own title id", () => {
    const a = view("https://a.test");
    const b = view("https://b.test");
    press(tile(a.container));
    press(tile(b.container));
    const ids = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].map((d) => d.getAttribute("aria-labelledby"));
    expect(new Set(ids).size).toBe(2);
  });
});
