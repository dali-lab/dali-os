// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { addSlide, notesFragment, slideFragment } from "~/components/slides/deck/deck-ops";
import { createDeckUndo } from "~/components/slides/deck/deck-undo";
import { addChart, addIcon, addTextBox, addVideo } from "~/components/slides/deck/freeform-ops";
import { deckMap, initDeck, slidesMap } from "~/components/slides/deck/model";
import { snapshotDeck } from "~/components/slides/deck/snapshot";
import { blocksToFragment } from "~/collab/blocknote-server";

vi.mock("~/components/EmojiPicker", () => ({
  EmojiPicker: (p: { onPick: (e: string, img?: string) => void }) =>
    createElement("div", null, createElement("button", { onClick: () => p.onPick("🚀") }, "pick rocket"), createElement("button", { onClick: () => p.onPick(":party:", "/x.png") }, "pick custom")),
}));

import { ContentSection } from "../ContentInspector";
import type { InspectorFreeform } from "../ElementInspector";
import { FindBar } from "../FindBar";
import { IconPickerModal, iconMatches, VideoUrlModal } from "../InsertPickers";
import { ShortcutsSheet } from "../ShortcutsSheet";
import { comboMatches, keysOf, SHORTCUT_GROUPS, SHORTCUTS, shortcutFor } from "../shortcuts";
import { useDeckFind, type DeckFind } from "../useDeckFind";
import { useFreeformEditor, type FreeformEditor } from "../useFreeformEditor";
import { useInsertItems } from "../useInsertItems";
import type { DeckDoc } from "../useDeckDoc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => (fn(), 1));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = (node: React.ReactElement) => {
  act(() => root.render(node));
  return container;
};
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
const byText = (scope: ParentNode, text: string, selector = "button") => [...scope.querySelectorAll(selector)].find((b) => b.textContent?.trim() === text) as HTMLElement;
const setValue = (input: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const commit = (input: HTMLInputElement, value: string) => {
  setValue(input, value);
  act(() => void input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
};
const paste = (target: Element, text: string) =>
  act(() => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.assign(event, { clipboardData: { getData: () => text } });
    target.dispatchEvent(event);
  });

function deck() {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  return { doc, slideId, slide: () => snapshotDeck(doc).slides[0] };
}
const api = (over: Partial<InspectorFreeform> = {}): InspectorFreeform => ({
  onPlace: vi.fn(), onAlign: vi.fn(), onDistribute: vi.fn(), onGroup: vi.fn(), onUngroup: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn(), onReorder: vi.fn(),
  onSnapBack: vi.fn(), onFill: vi.fn(), onDeselect: vi.fn(), prefs: { items: true, margins: true, grid: false }, onPrefs: vi.fn(),
  onChart: vi.fn(), onIcon: vi.fn(), onVideo: vi.fn(() => true), ...over,
});

describe("shortcuts list", () => {
  it("has unique ids and every group is used", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of SHORTCUT_GROUPS) expect(SHORTCUTS.some((s) => s.group === group), group).toBe(true);
    for (const s of SHORTCUTS) expect(Boolean(s.combos) !== Boolean(s.display), s.id).toBe(true);
  });

  it("resolves key presses to the same ids the sheet lists", () => {
    const e = (key: string, init: Partial<KeyboardEvent> = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init });
    expect(shortcutFor(e("z", { metaKey: true }))).toBe("undo");
    expect(shortcutFor(e("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(shortcutFor(e("y", { metaKey: true }))).toBe("redo");
    expect(shortcutFor(e("f", { metaKey: true }))).toBe("find");
    expect(shortcutFor(e("?", { shiftKey: true }))).toBe("help");
    expect(shortcutFor(e("?"))).toBe("help");
    expect(shortcutFor(e("z", { metaKey: true, altKey: true }))).toBeNull();
    expect(shortcutFor(e("z"))).toBeNull();
    expect(comboMatches(e("g", { metaKey: true, shiftKey: true }), { key: "g", mod: true })).toBe(false);
  });

  it("shows ⌘ on a Mac and Ctrl elsewhere", () => {
    const find = SHORTCUTS.find((s) => s.id === "find")!;
    expect(keysOf(find, true)).toEqual([["⌘", "F"]]);
    expect(keysOf(find, false)).toEqual([["Ctrl", "F"]]);
    expect(keysOf(SHORTCUTS.find((s) => s.id === "skipSnap")!, false)).toEqual([["Ctrl"]]);
  });
});

describe("ShortcutsSheet", () => {
  it("renders nothing while closed", () => {
    render(createElement(ShortcutsSheet, { open: false, onClose: vi.fn() }));
    expect(document.body.textContent).not.toContain("Keyboard shortcuts");
  });

  it("lists every shortcut under its group and closes", () => {
    const onClose = vi.fn();
    render(createElement(ShortcutsSheet, { open: true, onClose }));
    const sheet = document.querySelector("[role=dialog]")!;
    expect(sheet.textContent).toContain("Keyboard shortcuts");
    for (const def of SHORTCUTS) expect(sheet.querySelector(`[data-shortcut="${def.id}"]`), def.id).not.toBeNull();
    for (const group of SHORTCUT_GROUPS) expect(sheet.querySelector(`section[aria-label="${group}"]`)).not.toBeNull();
    click(sheet.querySelector("button[aria-label=Close]"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ContentSection for a chart", () => {
  const setup = () => {
    const d = deck();
    const id = addChart(d.doc, d.slideId, "bar")!;
    const freeform = api();
    const element = d.slide().elements.find((e) => e.id === id)!;
    const el = render(createElement(ContentSection, { element, editable: true, freeform }));
    return { el, freeform, element, id };
  };

  it("switches the chart type", () => {
    const { el, freeform, id } = setup();
    click(byText(el, "Pie", "[role=radio], button"));
    expect(freeform.onChart).toHaveBeenCalledWith(id, expect.objectContaining({ type: "pie" }));
  });

  it("edits a value, a label and a series name", () => {
    const { el, freeform, id } = setup();
    commit(el.querySelector<HTMLInputElement>('[aria-label="Row 2 Series 1"]')!, "42.5");
    expect((freeform.onChart as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].data.series[0].values).toEqual([12, 42.5, 8, 24]);
    commit(el.querySelector<HTMLInputElement>('[aria-label="Row 1 label"]')!, "Jan");
    expect((freeform.onChart as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].data.labels[0]).toBe("Jan");
    commit(el.querySelector<HTMLInputElement>('[aria-label="Series 1 name"]')!, "Revenue");
    expect((freeform.onChart as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toBe(id);
    expect((freeform.onChart as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].data.series[0].name).toBe("Revenue");
  });

  it("keeps the old value when a cell is not a number", () => {
    const { el, freeform } = setup();
    commit(el.querySelector<HTMLInputElement>('[aria-label="Row 1 Series 1"]')!, "lots");
    expect((freeform.onChart as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1].data.series[0].values[0] ?? 12).toBe(12);
  });

  it("adds and removes rows and series", () => {
    const { el, freeform } = setup();
    click(byText(el, "Row"));
    expect((freeform.onChart as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].data.labels).toHaveLength(5);
    click(byText(el, "Series"));
    expect((freeform.onChart as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].data.series).toHaveLength(2);
    click(el.querySelector('button[aria-label="Remove row 1"]'));
    expect((freeform.onChart as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].data.labels).toHaveLength(3);
  });

  it("replaces the data with cells pasted from a spreadsheet, and ignores plain text", () => {
    const { el, freeform } = setup();
    paste(el.querySelector("[data-chart-grid]")!, "\tA\tB\nx\t1\t2\ny\t3\t4");
    expect(freeform.onChart).toHaveBeenCalledWith(expect.any(String), { type: "bar", data: { labels: ["x", "y"], series: [{ name: "A", values: [1, 3] }, { name: "B", values: [2, 4] }] } });
    (freeform.onChart as ReturnType<typeof vi.fn>).mockClear();
    paste(el.querySelector("[data-chart-grid]")!, "hello");
    paste(el.querySelector("[data-chart-grid]")!, "\tA\nx\tnope");
    expect(freeform.onChart).not.toHaveBeenCalled();
  });

  it("is read only for someone who cannot edit", () => {
    const d = deck();
    const id = addChart(d.doc, d.slideId)!;
    const el = render(createElement(ContentSection, { element: d.slide().elements.find((e) => e.id === id)!, editable: false, freeform: api() }));
    expect(el.querySelector<HTMLInputElement>('[aria-label="Row 1 label"]')!.disabled).toBe(true);
    expect(byText(el, "Row")).toBeUndefined();
  });
});

describe("icon and video inspector", () => {
  it("changes an icon through the picker", () => {
    const d = deck();
    const id = addIcon(d.doc, d.slideId, "star")!;
    const freeform = api();
    const el = render(createElement(ContentSection, { element: d.slide().elements.find((e) => e.id === id)!, editable: true, freeform }));
    click(byText(el, "Change icon"));
    const search = document.querySelector<HTMLInputElement>("input[aria-label='Search icons']")!;
    setValue(search, "rocket");
    click(document.querySelector("[role=option][aria-label=rocket]"));
    expect(freeform.onIcon).toHaveBeenCalledWith(id, "rocket");
  });

  it("filters icons by every word and shows an empty message", () => {
    expect(iconMatches("arrow right")).toContain("arrow-right");
    expect(iconMatches("arrow right")).not.toContain("arrow-left");
    expect(iconMatches("zzzzzz")).toEqual([]);
    render(createElement(IconPickerModal, { open: true, onClose: vi.fn(), onPick: vi.fn() }));
    setValue(document.querySelector<HTMLInputElement>("input[aria-label='Search icons']")!, "zzzzzz");
    expect(document.body.textContent).toContain("No icons found.");
  });

  it("changes a video link only to one the registry supports", () => {
    const d = deck();
    const id = addVideo(d.doc, d.slideId, "https://youtu.be/dQw4w9WgXcQ")!;
    const freeform = api();
    const el = render(createElement(ContentSection, { element: d.slide().elements.find((e) => e.id === id)!, editable: true, freeform }));
    click(byText(el, "Change video"));
    const input = document.querySelector<HTMLInputElement>("input[type=text]")!;
    setValue(input, "https://example.com/movie");
    const save = byText(document.body, "Save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(document.body.textContent).toContain("Paste a YouTube link.");
    setValue(input, "https://youtu.be/aaaaaaaaaaa");
    expect((byText(document.body, "Save") as HTMLButtonElement).disabled).toBe(false);
    act(() => void document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(freeform.onVideo).toHaveBeenCalledWith(id, "https://youtu.be/aaaaaaaaaaa");
  });

  it("shows nothing extra for other kinds", () => {
    const d = deck();
    const id = addTextBox(d.doc, d.slideId)!;
    const el = render(createElement(ContentSection, { element: d.slide().elements.find((e) => e.id === id)!, editable: true, freeform: api() }));
    expect(el.textContent).toBe("");
  });
});

describe("VideoUrlModal", () => {
  it("submits a trimmed supported link", () => {
    const onSubmit = vi.fn();
    render(createElement(VideoUrlModal, { open: true, onClose: vi.fn(), onSubmit }));
    setValue(document.querySelector<HTMLInputElement>("input[type=text]")!, "  https://youtu.be/dQw4w9WgXcQ ");
    act(() => void document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSubmit).toHaveBeenCalledWith("https://youtu.be/dQw4w9WgXcQ");
  });
});

describe("inserting from the editor", () => {
  let editor: FreeformEditor;
  let items: ReturnType<typeof useInsertItems>;
  const pickImage = vi.fn();

  function Harness(p: { deck: DeckDoc; slide: ReturnType<typeof snapshotDeck>["slides"][number] }) {
    editor = useFreeformEditor({ deck: p.deck, slide: p.slide, editable: true });
    items = useInsertItems({ insert: editor.insert, arm: editor.arm, pickImage });
    return items.pickers;
  }

  function setup() {
    const doc = new Y.Doc();
    initDeck(doc);
    const slideId = addSlide(doc, "blank", null);
    const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
    undo.manager.clear();
    const awareness = { clientID: 1, getStates: () => new Map(), on() {}, off() {}, setLocalStateField() {} };
    const deck = { doc, undo, entry: { provider: { awareness } }, store: {} } as unknown as DeckDoc;
    const draw = () => act(() => root.render(createElement(Harness, { deck, slide: snapshotDeck(doc).slides[0] })));
    draw();
    return { doc, slideId, undo, draw };
  }
  const elements = (doc: Y.Doc) => snapshotDeck(doc).slides[0].elements;

  it("places a table, chart or code block in one undo step, selects it and can undo it", () => {
    const { doc, undo, draw } = setup();
    for (const item of [{ type: "table" }, { type: "chart", chart: "line" }, { type: "code" }] as const) {
      act(() => items.insertItem(item));
      draw();
      const added = elements(doc).at(-1)!;
      expect(editor.selection).toEqual([added.id]);
    }
    expect(elements(doc).map((e) => e.kind)).toEqual(["text", "chart", "text"]);
    undo.manager.undo();
    expect(elements(doc).map((e) => e.kind)).toEqual(["text", "text"]);
  });

  it("opens a picker for icons, emoji and video and places the element on choosing", () => {
    const { doc, draw } = setup();
    act(() => items.insertItem({ type: "icon" }));
    draw();
    click(document.querySelector("[role=option][aria-label=star]"));
    draw();
    expect(elements(doc).map((e) => [e.kind, e.icon])).toEqual([["icon", "star"]]);
    expect(document.querySelector("[role=listbox]")).toBeNull();

    act(() => items.insertItem({ type: "emoji" }));
    draw();
    click(byText(document.body, "pick custom"));
    expect(elements(doc)).toHaveLength(1);
    click(byText(document.body, "pick rocket"));
    draw();
    expect(elements(doc).at(-1)).toMatchObject({ kind: "text", textStyle: "title" });

    act(() => items.insertItem({ type: "video" }));
    draw();
    setValue(document.querySelector<HTMLInputElement>("input[type=text]")!, "https://youtu.be/dQw4w9WgXcQ");
    act(() => void document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    draw();
    expect(elements(doc).at(-1)).toMatchObject({ kind: "video" });
  });

  it("places at a given point, for menus that know where the pointer is", () => {
    const { doc, draw } = setup();
    act(() => void editor.insert.chart("bar", { x: 960, y: 540 }));
    draw();
    expect(elements(doc)[0]).toMatchObject({ x: 480, y: 270 });
  });

  it("arms text and shapes, and opens the image chooser", () => {
    const { draw } = setup();
    act(() => items.insertItem({ type: "text" }));
    draw();
    expect(editor.armed).toEqual({ type: "text" });
    act(() => items.insertItem({ type: "shape", shape: "arrow" }));
    draw();
    expect(editor.armed).toEqual({ type: "shape", shape: "arrow" });
    act(() => items.insertItem({ type: "image" }));
    expect(pickImage).toHaveBeenCalled();
  });

  it("changes chart data, icon and video through the inspector actions as one step each", () => {
    const { doc, undo, draw } = setup();
    act(() => void editor.insert.chart("bar"));
    draw();
    const id = elements(doc)[0].id;
    act(() => editor.inspector.onChart!(id, { type: "pie", data: { labels: ["A"], series: [{ name: "S", values: [1] }] } }));
    expect(elements(doc)[0].chart?.type).toBe("pie");
    undo.manager.undo();
    expect(elements(doc)[0].chart?.type).toBe("bar");
  });
});

describe("find and replace bar", () => {
  let find: DeckFind;
  const revealed: Array<[string, string | null]> = [];
  function Harness({ deck, snap, bar = true }: { deck: DeckDoc; snap: ReturnType<typeof snapshotDeck>; bar?: boolean }) {
    find = useDeckFind({ deck, snap, editable: true, onReveal: (s, k) => revealed.push([s, k]) });
    return find.open && bar ? createElement(FindBar, { find }) : null;
  }
  function setup() {
    const doc = new Y.Doc();
    initDeck(doc);
    const a = addSlide(doc, "content", null);
    const b = addSlide(doc, "content", a);
    blocksToFragment([{ type: "paragraph", content: "cat one" }] as never, slideFragment(doc, a, "title")!);
    blocksToFragment([{ type: "paragraph", content: "a cat and another cat" }] as never, slideFragment(doc, b, "body")!);
    blocksToFragment([{ type: "paragraph", content: "cat notes" }] as never, notesFragment(doc, b)!);
    const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
    undo.manager.clear();
    const deck = { doc, undo } as unknown as DeckDoc;
    const draw = () => act(() => root.render(createElement(Harness, { deck, snap: snapshotDeck(doc) })));
    draw();
    revealed.length = 0;
    return { doc, a, b, undo, draw };
  }
  const bar = () => document.querySelector("[data-find-bar]")!;

  it("opens on Cmd+F, even from inside a text box, and prevents the browser's own find", () => {
    const { draw } = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true });
    act(() => void input.dispatchEvent(event));
    draw();
    expect(event.defaultPrevented).toBe(true);
    expect(bar()).not.toBeNull();
    input.remove();
  });

  it("counts matches, steps through them and reveals each one's slide and text box", () => {
    const { draw } = setup();
    act(() => find.show());
    draw();
    act(() => find.setQuery("cat"));
    draw();
    expect(bar().querySelector("[data-find-status]")!.textContent).toBe("1 of 4");
    expect(revealed.at(-1)).toEqual([expect.any(String), "title"]);
    click(bar().querySelector("button[aria-label='Next match']"));
    draw();
    expect(bar().querySelector("[data-find-status]")!.textContent).toBe("2 of 4");
    expect(revealed.at(-1)![1]).toBe("body");
    click(bar().querySelector("button[aria-label='Next match']"));
    click(bar().querySelector("button[aria-label='Next match']"));
    draw();
    expect(bar().querySelector("[data-find-status]")!.textContent).toBe("4 of 4");
    click(bar().querySelector("button[aria-label='Next match']"));
    draw();
    expect(bar().querySelector("[data-find-status]")!.textContent).toBe("1 of 4");
    click(bar().querySelector("button[aria-label='Previous match']"));
    draw();
    expect(revealed.at(-1)).toEqual([expect.any(String), null]);
  });

  it("says when nothing matches and disables stepping", () => {
    const { draw } = setup();
    act(() => find.show("zebra"));
    draw();
    expect(bar().querySelector("[data-find-status]")!.textContent).toBe("No matches");
    expect((bar().querySelector("button[aria-label='Next match']") as HTMLButtonElement).disabled).toBe(true);
    expect((byText(bar(), "Replace all") as HTMLButtonElement).disabled).toBe(true);
  });

  it("replaces the current match, then all, and undoes replace all in one step", () => {
    const { doc, undo, draw } = setup();
    act(() => find.show("cat"));
    draw();
    act(() => find.setReplacement("dog"));
    draw();
    click(byText(bar(), "Replace"));
    draw();
    expect(find.matches).toHaveLength(3);
    click(byText(bar(), "Replace all"));
    draw();
    expect(find.matches).toHaveLength(0);
    expect(JSON.stringify(readText(doc))).not.toContain("cat");
    undo.manager.undo();
    draw();
    expect(find.matches).toHaveLength(3);
    undo.manager.undo();
    draw();
    expect(find.matches).toHaveLength(4);
  });

  it("closes on Escape", () => {
    const { draw } = setup();
    act(() => find.show("cat"));
    draw();
    act(() => void bar().querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    draw();
    expect(document.querySelector("[data-find-bar]")).toBeNull();
  });
});

function readText(doc: Y.Doc) {
  return snapshotDeck(doc).slides.flatMap((s) => s.elements.map((e) => e.blocks));
}
