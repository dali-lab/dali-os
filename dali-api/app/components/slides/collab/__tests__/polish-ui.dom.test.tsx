// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import * as Y from "yjs";
import { addSlide, moveSlides, visibleSlideIds } from "~/components/slides/deck/deck-ops";
import { initDeck } from "~/components/slides/deck/model";
import { SlideRender } from "~/components/slides/deck/SlideRender";
import { snapshotDeck, type RenderSlide } from "~/components/slides/deck/snapshot";
import { actingSet, dropIndex } from "../filmstrip-select";
import { actionIds, findAction, sectionActions, stageActions, thumbnailActions } from "../actions";
import { Filmstrip } from "../Filmstrip";
import { GridView } from "../GridView";
import { LayoutGalleryModal, LayoutGrid } from "../LayoutPicker";
import { NewSlideSplit } from "../NewSlideSplit";
import { BackgroundSection, TransitionSection } from "../SlideSettings";
import { SHORTCUTS } from "../shortcuts";

vi.mock("~/components/ui/Avatar", () => ({ Avatar: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = (node: React.ReactElement) => (act(() => root.render(node)), container);
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
const noop = () => {};

function deck(n: number, tweak: (s: RenderSlide, i: number) => RenderSlide = (s) => s) {
  const doc = new Y.Doc();
  initDeck(doc);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(addSlide(doc, "content", ids[i - 1] ?? null));
  return { doc, ids, slides: snapshotDeck(doc).slides.map(tweak) };
}

describe("background rendering", () => {
  const base: RenderSlide = { id: "s", pos: 0, layoutId: "blank", elements: [] };
  const stage = (slide: RenderSlide, props: object = {}) => {
    render(createElement(SlideRender, { slide, theme: "dali-dark", ...props }));
    return container.querySelector<HTMLElement>("[data-slide-stage]")!;
  };

  it("uses the theme ground by default and a theme color when set", () => {
    expect(stage(base).style.background).toBe("var(--slide-ground)");
    expect(stage({ ...base, background: { kind: "color", token: "accent" } }).style.background).toBe("var(--slide-accent)");
  });

  it("draws a background image behind the content, filling or fitting", () => {
    const s = stage({ ...base, background: { kind: "image", url: "/api/upload/raw?key=uploads/a.png", fit: "contain" } });
    const img = s.querySelector<HTMLImageElement>("[data-slide-background]")!;
    expect(img.getAttribute("src")).toBe("/api/upload/raw?key=uploads/a.png");
    expect(img.style.objectFit).toBe("contain");
    expect(s.firstElementChild).toBe(img);
  });

  it("leaves the background out when transparent, for a layer over another slide", () => {
    const s = stage({ ...base, background: { kind: "image", url: "/a.png", fit: "cover" } }, { transparent: true });
    expect(s.querySelector("[data-slide-background]")).toBeNull();
    expect(s.style.background).toBe("transparent");
  });

  it("renders the same markup for the PDF", () => {
    const html = renderToStaticMarkup(SlideRender({ slide: { ...base, background: { kind: "image", url: "/a.png", fit: "cover" } }, theme: "dali-light" }));
    expect(html).toContain("data-slide-background");
    expect(renderToStaticMarkup(SlideRender({ slide: { ...base, background: { kind: "color", token: "surface" } }, theme: "dali-light" }))).toContain("background:var(--slide-surface)");
  });

  it("thumbnails show it too", () => {
    const { slides } = deck(1, (s) => ({ ...s, background: { kind: "color", token: "rule" } }));
    render(createElement(Filmstrip, { slides, themeId: "dali-dark", currentId: null, peers: new Map(), editable: false, onSelect: noop, onAdd: noop, onDuplicate: noop, onDelete: noop, onMove: noop }));
    expect(container.querySelector<HTMLElement>("[data-slide-stage]")!.style.background).toBe("var(--slide-rule)");
  });
});

describe("layout gallery", () => {
  it("draws each layout as a real slide in the deck theme", () => {
    const onPick = vi.fn();
    render(createElement(LayoutGrid, { themeId: "dali-light", onPick }));
    const thumbs = container.querySelectorAll("[data-layout-thumb]");
    expect(thumbs.length).toBeGreaterThanOrEqual(4);
    expect(thumbs[0].querySelector("[data-slide-stage]")!.getAttribute("data-theme")).toBe("dali-light");
    click(container.querySelector("[data-layout-thumb='title']")!.closest("button"));
    expect(onPick).toHaveBeenCalledWith("title");
  });

  it("opens in a dialog for Change layout and picks one", () => {
    const onPick = vi.fn();
    render(createElement(LayoutGalleryModal, { title: "Choose a layout", themeId: "dali-dark", value: "content", onPick, onClose: noop }));
    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog.querySelector("button[aria-pressed=true] [data-layout-thumb=content]")).not.toBeNull();
    click(dialog.querySelector("[data-layout-thumb=blank]")!.closest("button"));
    expect(onPick).toHaveBeenCalledWith("blank");
  });

  it("New slide adds the current layout on click and offers the gallery from the arrow", () => {
    const onAdd = vi.fn();
    render(createElement(NewSlideSplit, { themeId: "dali-dark", layoutId: "split", onAdd }));
    click([...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "New slide"));
    expect(onAdd).toHaveBeenLastCalledWith("split");
    click(container.querySelector("button[aria-label='Choose a layout']"));
    click(document.querySelector("[data-layout-thumb=title]")!.closest("button"));
    expect(onAdd).toHaveBeenLastCalledWith("title");
  });

  it("falls back to the content layout when there is no current slide", () => {
    const onAdd = vi.fn();
    render(createElement(NewSlideSplit, { themeId: "dali-dark", layoutId: null, onAdd }));
    click([...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "New slide"));
    expect(onAdd).toHaveBeenCalledWith("content");
  });
});

describe("menus", () => {
  const stage = (over: object = {}) => {
    const h = { paste: vi.fn(), insert: vi.fn(), changeLayout: vi.fn(), openLayoutGallery: vi.fn(), setBackground: vi.fn(), pickBackgroundImage: vi.fn(), selectAll: vi.fn(), comment: vi.fn(), setGuides: vi.fn(), setGrid: vi.fn() };
    return { h, actions: stageActions({ layoutId: "content", canPaste: true, canComment: false, guides: true, grid: false, handlers: h, ...over }) };
  };

  it("right-click on empty space offers a Background menu and the layout gallery", () => {
    const { h, actions } = stage();
    findAction(actions, "background-accent")!.run!();
    expect(h.setBackground).toHaveBeenLastCalledWith({ kind: "color", token: "accent" });
    findAction(actions, "background-ground")!.run!();
    expect(h.setBackground).toHaveBeenLastCalledWith(null);
    findAction(actions, "background-image")!.run!();
    expect(h.pickBackgroundImage).toHaveBeenCalled();
    findAction(actions, "layout-gallery")!.run!();
    expect(h.openLayoutGallery).toHaveBeenCalled();
    expect(findAction(actions, "background-ground")!.checked).toBe(true);
    expect(findAction(stage({ background: { kind: "color", token: "fg" } }).actions, "background-fg")!.checked).toBe(true);
  });

  const thumb = (startsSection: boolean, many = false) => {
    const { slides } = deck(many ? 2 : 1);
    const h = { newAfter: vi.fn(), duplicate: vi.fn(), remove: vi.fn(), skip: vi.fn(), changeLayout: vi.fn(), openLayoutGallery: vi.fn(), addSection: vi.fn(), renameSection: vi.fn(), removeSection: vi.fn(), copy: vi.fn(), paste: vi.fn(), moveTo: vi.fn(), comment: vi.fn() };
    return { h, actions: thumbnailActions({ targets: slides, index: 0, count: 3, canPaste: true, canComment: false, startsSection, handlers: h }) };
  };

  it("thumbnail menu adds, renames and removes sections, and opens the gallery", () => {
    const first = thumb(false);
    expect(actionIds(first.actions)).toContain("add-section");
    expect(actionIds(first.actions)).not.toContain("rename-section");
    findAction(first.actions, "add-section")!.run!();
    expect(first.h.addSection).toHaveBeenCalled();
    findAction(first.actions, "layout-gallery")!.run!();
    expect(first.h.openLayoutGallery).toHaveBeenCalled();
    const started = thumb(true);
    expect(actionIds(started.actions)).toEqual(expect.arrayContaining(["rename-section", "remove-section"]));
    expect(actionIds(started.actions)).not.toContain("add-section");
    findAction(started.actions, "remove-section")!.run!();
    expect(started.h.removeSection).toHaveBeenCalled();
    expect(actionIds(thumb(false, true).actions)).not.toContain("add-section");
  });

  it("section header menu renames, removes and moves, with the ends disabled", () => {
    const h = { rename: vi.fn(), remove: vi.fn(), moveUp: vi.fn(), moveDown: vi.fn() };
    const actions = sectionActions(h, { first: true, last: false });
    expect(findAction(actions, "section-up")!.disabled).toBe(true);
    expect(findAction(actions, "section-down")!.disabled).toBe(false);
    findAction(actions, "section-down")!.run!();
    findAction(actions, "section-remove")!.run!();
    expect(h.moveDown).toHaveBeenCalled();
    expect(h.remove).toHaveBeenCalled();
  });
});

describe("filmstrip sections", () => {
  const props = (slides: RenderSlide[], over: object = {}) => ({ slides, themeId: "dali-dark", currentId: null, peers: new Map(), editable: true, onSelect: noop, onAdd: noop, onDuplicate: noop, onDelete: noop, onMove: noop, ...over });
  const sectioned = () => deck(5, (s, i) => (i === 1 ? { ...s, section: "Middle" } : i === 3 ? { ...s, section: "End" } : s));

  it("shows a header per section with its slide count", () => {
    render(createElement(Filmstrip, props(sectioned().slides)));
    const headers = [...container.querySelectorAll("[data-section-header]")];
    expect(headers.map((h) => h.getAttribute("data-section-header"))).toEqual(["Middle", "End"]);
    expect(headers[0].textContent).toContain("2");
    expect(container.querySelectorAll("button[aria-label^='Slide ']")).toHaveLength(5);
  });

  it("collapses and expands a section, keeping slide numbers", () => {
    render(createElement(Filmstrip, props(sectioned().slides)));
    click(container.querySelector("[data-section-header='Middle'] button"));
    expect([...container.querySelectorAll("button[aria-label^='Slide ']")].map((b) => b.getAttribute("aria-label"))).toEqual(["Slide 1", "Slide 4", "Slide 5"]);
    expect(container.querySelector("[data-section-header='Middle'] button")!.getAttribute("aria-expanded")).toBe("false");
    click(container.querySelector("[data-section-header='Middle'] button"));
    expect(container.querySelectorAll("button[aria-label^='Slide ']")).toHaveLength(5);
  });

  it("has no headers for a deck without sections", () => {
    render(createElement(Filmstrip, props(deck(2).slides)));
    expect(container.querySelector("[data-section-header]")).toBeNull();
  });
});

describe("grid view", () => {
  const props = (slides: RenderSlide[], over: object = {}) => ({ slides, themeId: "dali-dark", currentId: slides[0].id, selectedIds: [], editable: true, onSelect: noop, onMove: noop, onOpen: noop, ...over });

  it("shows every slide, with section names, and selects on click", () => {
    const { slides } = deck(3, (s, i) => (i === 1 ? { ...s, section: "Part two" } : s));
    const onSelect = vi.fn();
    render(createElement(GridView, props(slides, { onSelect })));
    expect(container.querySelectorAll("[data-grid-slide]")).toHaveLength(3);
    expect(container.textContent).toContain("Part two");
    click(container.querySelector("button[aria-label='Slide 2']"));
    expect(onSelect).toHaveBeenCalledWith(slides[1].id, { shift: false, meta: false });
  });

  it("opens a slide on double-click", () => {
    const { slides } = deck(2);
    const onOpen = vi.fn();
    render(createElement(GridView, props(slides, { onOpen })));
    act(() => void container.querySelector("button[aria-label='Slide 2']")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onOpen).toHaveBeenCalledWith(slides[1].id);
  });

  it("marks the selection and uses the thumbnail actions on right-click", () => {
    const { slides } = deck(2);
    const actionsFor = vi.fn(() => [{ id: "x", label: "Do it", run: vi.fn() }]);
    render(createElement(GridView, props(slides, { selectedIds: [slides[1].id], actionsFor })));
    expect(container.querySelector("button[aria-label='Slide 2']")!.getAttribute("aria-selected")).toBe("true");
    act(() => void container.querySelector("button[aria-label='Slide 1']")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })));
    expect(actionsFor).toHaveBeenCalledWith(slides[0].id);
  });

  it("reorders a multi-selection together in one step, like the filmstrip", () => {
    const { doc, ids } = deck(5);
    const order = visibleSlideIds(doc);
    const moving = actingSet(order, [ids[0], ids[1]], ids[1]);
    expect(moving).toEqual([ids[0], ids[1]]);
    moveSlides(doc, moving, dropIndex(order, moving, ids[3])!);
    expect(visibleSlideIds(doc)).toEqual([ids[2], ids[3], ids[0], ids[1], ids[4]]);
  });
});

describe("shortcuts", () => {
  it("lists the grid toggle once", () => {
    expect(SHORTCUTS.filter((s) => s.id === "grid")).toHaveLength(1);
  });
});

describe("inspector sections", () => {
  const slide: RenderSlide = { id: "s", pos: 0, layoutId: "content", elements: [] };

  it("background: picks a theme color, resets, picks an image and sets how it fits", () => {
    const onChange = vi.fn();
    const onPickImage = vi.fn();
    render(createElement(BackgroundSection, { slide, themeId: "dali-dark", editable: true, onChange, onPickImage }));
    click(container.querySelector("button[aria-label='Accent']"));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "color", token: "accent" });
    click(container.querySelector("button[aria-label='Default']"));
    expect(onChange).toHaveBeenLastCalledWith(null);
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Image background"));
    expect(onPickImage).toHaveBeenCalled();
    const withImage = { ...slide, background: { kind: "image" as const, url: "/a.png", fit: "cover" as const } };
    render(createElement(BackgroundSection, { slide: withImage, themeId: "dali-dark", editable: true, onChange, onPickImage }));
    click([...container.querySelectorAll("[role=radio], button")].find((b) => b.textContent === "Fit"));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "image", url: "/a.png", fit: "contain" });
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Remove"));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("background: read only for viewers", () => {
    render(createElement(BackgroundSection, { slide, themeId: "dali-dark", editable: false, onChange: noop, onPickImage: noop }));
    expect((container.querySelector("button[aria-label='Accent']") as HTMLButtonElement).disabled).toBe(true);
  });

  it("transition: chooses a kind, edits the duration and previews", () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    render(createElement(TransitionSection, { slide, editable: true, onChange, onPreview }));
    expect(container.textContent).not.toContain("Preview");
    click([...container.querySelectorAll("[role=radio], button")].find((b) => b.textContent === "Magic"));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "magic" });
    const withT = { ...slide, transition: { kind: "push" as const, duration: 800 } };
    render(createElement(TransitionSection, { slide: withT, editable: true, onChange, onPreview }));
    click([...container.querySelectorAll("[role=radio], button")].find((b) => b.textContent === "None"));
    expect(onChange).toHaveBeenLastCalledWith(null);
    click([...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Preview")));
    expect(onPreview).toHaveBeenCalled();
    const input = container.querySelector<HTMLInputElement>("input[aria-label='Transition duration']")!;
    expect(input.value).toBe("800");
  });
});
