// @vitest-environment jsdom
import { stageFreeform } from "./stage-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { addSlide, slideFragment } from "~/components/slides/deck/deck-ops";
import { initDeck } from "~/components/slides/deck/model";
import { snapshotDeck, type RenderSlide } from "~/components/slides/deck/snapshot";

vi.mock("~/components/doc/DocEditor", () => ({
  DocEditor: (p: { placeholder?: string; comments?: { scope?: { slideId: string; elementId: string }; pageId: string } }) =>
    createElement("div", { "data-testid": "doc-editor", "data-scope": p.comments?.scope ? `${p.comments.pageId}|${p.comments.scope.slideId}|${p.comments.scope.elementId}` : "" }, p.placeholder),
}));
vi.mock("~/components/ui/Avatar", () => ({ Avatar: (p: { name: string }) => createElement("span", { "data-avatar": p.name }) }));

import { Filmstrip } from "../Filmstrip";
import { DeletedSlideNotice, SlideStage, stageKey } from "../SlideStage";
import { ReadOnlyDeck } from "../ReadOnlyDeck";
import { Inspector } from "../Inspector";
import type { SlotCollab } from "../SlotEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 960 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 540 });
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
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

function deck(n: number) {
  const doc = new Y.Doc();
  initDeck(doc);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(addSlide(doc, "split", ids[i - 1] ?? null));
  return { doc, ids, snap: snapshotDeck(doc) };
}
const click = (el: Element | null) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
const freeformFor = (selection: string[]) => stageFreeform(selection);
const noop = () => {};
const collab: SlotCollab = { room: "slides:p:deck", token: "t", user: { userId: "u", name: "Ada", color: "#336699", photoUrl: null }, undoExtension: {} };

describe("Filmstrip", () => {
  const props = (slides: RenderSlide[], over: Partial<Parameters<typeof Filmstrip>[0]> = {}) => ({
    slides,
    themeId: "dali-dark",
    currentId: slides[0]?.id ?? null,
    peers: new Map(),
    editable: true,
    onSelect: noop,
    onAdd: noop,
    onDuplicate: noop,
    onDelete: noop,
    onMove: noop,
    ...over,
  });

  it("lists slides in order and marks the current one", () => {
    const { snap } = deck(3);
    const el = render(createElement(Filmstrip, props(snap.slides, { currentId: snap.slides[1].id })));
    const buttons = [...el.querySelectorAll("button[aria-label^='Slide ']")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Slide 1", "Slide 2", "Slide 3"]);
    expect(buttons.map((b) => b.getAttribute("aria-current"))).toEqual([null, "true", null]);
  });

  it("selects, duplicates and deletes the slide it is asked to", () => {
    const { snap } = deck(2);
    const onSelect = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    const el = render(createElement(Filmstrip, props(snap.slides, { onSelect, onDuplicate, onDelete })));
    click(el.querySelector("button[aria-label='Slide 2']"));
    click(el.querySelectorAll("button[aria-label='Duplicate slide']")[1]);
    click(el.querySelectorAll("button[aria-label='Delete slide']")[0]);
    expect(onSelect).toHaveBeenCalledWith(snap.slides[1].id, { shift: false, meta: false });
    expect(onDuplicate).toHaveBeenCalledWith(snap.slides[1].id);
    expect(onDelete).toHaveBeenCalledWith(snap.slides[0].id);
  });

  it("shows who else is on a slide", () => {
    const { snap } = deck(2);
    const peers = new Map([[snap.slides[1].id, [{ clientId: 7, userId: "u2", name: "Grace", color: "#aa3366", photoUrl: null }]]]);
    const el = render(createElement(Filmstrip, props(snap.slides, { peers })));
    expect(el.querySelectorAll("[data-testid=slide-presence]")).toHaveLength(1);
    expect(el.querySelector("[data-avatar='Grace']")).not.toBeNull();
  });

  it("offers no editing controls to a reader", () => {
    const { snap } = deck(2);
    const el = render(createElement(Filmstrip, props(snap.slides, { editable: false })));
    expect(el.querySelector("button[aria-label='Delete slide']")).toBeNull();
    expect(el.textContent).not.toContain("New slide");
  });
});

describe("SlideStage", () => {
  it("mounts a live editor for each text slot of the current slide and none for the image", () => {
    const { doc, snap } = deck(1);
    const el = render(
      createElement(SlideStage, {
        slide: snap.slides[0], themeId: "dali-dark", doc, collab, editable: true, onPickImage: noop,
      }),
    );
    expect(el.querySelectorAll("[data-testid=doc-editor]")).toHaveLength(2);
    expect(el.querySelector("button[aria-label='Add image']")).not.toBeNull();
  });

  it("mounts no editors when the viewer can't edit", () => {
    const { doc, snap } = deck(1);
    const el = render(
      createElement(SlideStage, {
        slide: snap.slides[0], themeId: "dali-dark", doc, collab: null, editable: false, onPickImage: noop,
      }),
    );
    expect(el.querySelectorAll("[data-testid=doc-editor]")).toHaveLength(0);
    expect(el.querySelector("[data-slide-stage]")).not.toBeNull();
  });

  it("falls back to static text for a slot with no fragment", () => {
    const { doc, ids, snap } = deck(1);
    expect(slideFragment(doc, ids[0], "title")).not.toBeNull();
    const el = render(
      createElement(SlideStage, {
        slide: { ...snap.slides[0], layoutId: "section" }, themeId: "dali-dark", doc, collab, editable: true, onPickImage: noop,
      }),
    );
    expect(el.querySelectorAll("[data-testid=doc-editor]")).toHaveLength(1);
  });

  it("remounts editors on a new restore epoch or slide", () => {
    expect(stageKey(0, "a")).not.toBe(stageKey(1, "a"));
    expect(stageKey(0, "a")).not.toBe(stageKey(0, "b"));
    expect(stageKey(2, "a")).toBe(stageKey(2, "a"));
  });
});

describe("slide comments in the filmstrip", () => {
  const filmProps = (slides: RenderSlide[], over: Record<string, unknown> = {}) => ({
    slides, themeId: "dali-dark", currentId: slides[0].id, peers: new Map(), editable: true,
    onSelect: noop, onAdd: noop, onDuplicate: noop, onDelete: noop, onMove: noop, ...over,
  });

  it("badges each thumbnail with its thread count and hides zero", () => {
    const { snap } = deck(3);
    const counts = new Map([[snap.slides[0].id, 2], [snap.slides[2].id, 1]]);
    const el = render(createElement(Filmstrip, filmProps(snap.slides, { commentCounts: counts }) as never));
    expect([...el.querySelectorAll("[data-testid=slide-comment-count]")].map((n) => n.textContent)).toEqual(["2", "1"]);
  });

  it("offers Comment from the thumbnail's context menu", () => {
    const { snap } = deck(2);
    const run = vi.fn();
    const actions = () => [{ id: "comment", label: "Comment", run }];
    const el = render(createElement(Filmstrip, filmProps(snap.slides, { actionsFor: actions }) as never));
    act(() => void el.querySelector("button[aria-label='Slide 2']")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })));
    const item = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Comment");
    expect(item).toBeTruthy();
    click(item!);
    expect(run).toHaveBeenCalled();
  });

  it("has no menu when the filmstrip is given no actions", () => {
    const { snap } = deck(1);
    const el = render(createElement(Filmstrip, filmProps(snap.slides) as never));
    act(() => void el.querySelector("button[aria-label='Slide 1']")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(document.body.querySelector("[role=menu]")).toBeNull();
  });
});

describe("slide comments on the stage", () => {
  const stageComments = (over: Record<string, unknown> = {}) => ({
    pageId: "page-1", viewerId: "u", canComment: true, canModerate: false, pins: [], focusedPinId: null, onOpenPin: noop, onStart: noop, ...over,
  });
  const stage = (snapSlide: RenderSlide, doc: Y.Doc, comments: unknown, selectedSlot: string | null = null) =>
    createElement(SlideStage, {
      slide: snapSlide, themeId: "dali-dark", doc, collab, editable: true, freeform: freeformFor(selectedSlot ? [selectedSlot] : []), onPickImage: noop, comments,
    } as never);

  it("scopes each text box's comment threads to its slide and element", () => {
    const { doc, snap } = deck(1);
    const el = render(stage(snap.slides[0], doc, stageComments()));
    const scopes = [...el.querySelectorAll("[data-testid=doc-editor]")].map((e) => e.getAttribute("data-scope"));
    expect(scopes.sort()).toEqual([`page-1|${snap.slides[0].id}|body`, `page-1|${snap.slides[0].id}|title`]);
  });

  it("leaves text boxes without comment scope when comments are off", () => {
    const { doc, snap } = deck(1);
    const el = render(stage(snap.slides[0], doc, undefined));
    expect([...el.querySelectorAll("[data-testid=doc-editor]")].every((e) => e.getAttribute("data-scope") === "")).toBe(true);
  });

  it("draws a dot for each pinned thread and opens it on click", () => {
    const { doc, snap } = deck(1);
    const onOpenPin = vi.fn();
    const pins = [{ threadId: "t1", x: 0.25, y: 0.5, author: "Grace", authorPhotoUrl: null, replies: 0 }];
    const el = render(stage(snap.slides[0], doc, stageComments({ pins, onOpenPin })));
    const pin = el.querySelector("[data-comment-pin=t1]") as HTMLElement;
    expect(pin.style.left).toBe("25%");
    expect(pin.style.top).toBe("50%");
    click(pin);
    expect(onOpenPin).toHaveBeenCalledWith("t1");
  });

  it("offers Comment on the selected text box, for the element", () => {
    const { doc, snap } = deck(1);
    const onStart = vi.fn();
    const el = render(stage(snap.slides[0], doc, stageComments({ onStart }), "title"));
    expect(el.querySelectorAll("button[aria-label^='Comment on ']")).toHaveLength(1);
    click(el.querySelector("button[aria-label='Comment on title']"));
    expect(onStart).toHaveBeenCalledWith({ slideId: snap.slides[0].id, elementId: "title" });
  });

  it("shows pins but no comment buttons to someone who cannot comment", () => {
    const { doc, snap } = deck(1);
    const pins = [{ threadId: "t1", x: 0.1, y: 0.1, author: "Grace", authorPhotoUrl: null, replies: 1 }];
    const el = render(stage(snap.slides[0], doc, stageComments({ canComment: false, pins }), "title"));
    expect(el.querySelector("[data-comment-pin=t1]")).not.toBeNull();
    expect(el.querySelector("button[aria-label='Comment on title']")).toBeNull();
  });
});

describe("deleted slide notice", () => {
  it("names who deleted it and restores on click", () => {
    const onRestore = vi.fn();
    const el = render(createElement(DeletedSlideNotice, { by: "Grace", onRestore }));
    expect(el.textContent).toContain("Deleted by Grace");
    click([...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Restore")) ?? null);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("copes with an unknown deleter", () => {
    expect(render(createElement(DeletedSlideNotice, { by: null, onRestore: noop })).textContent).toContain("This slide was deleted");
  });
});

describe("ReadOnlyDeck", () => {
  it("shows the notice and no editing surface", () => {
    const { snap } = deck(2);
    const el = render(createElement(ReadOnlyDeck, { slides: snap.slides, themeId: "dali-dark", notice: "Newer version" }));
    expect(el.textContent).toContain("Newer version");
    expect(el.querySelectorAll("[data-testid=doc-editor]")).toHaveLength(0);
    click(el.querySelector("button[aria-label='Slide 2']"));
    expect(el.querySelector("button[aria-label='Slide 2']")!.getAttribute("aria-current")).toBe("true");
  });

  it("follows the slide the page chooses and reports thumbnail clicks", () => {
    const { snap } = deck(3);
    const onSelect = vi.fn();
    const el = render(createElement(ReadOnlyDeck, { slides: snap.slides, themeId: "dali-dark", currentId: snap.slides[2].id, onSelect }));
    expect(el.querySelector("button[aria-label='Slide 3']")!.getAttribute("aria-current")).toBe("true");
    click(el.querySelector("button[aria-label='Slide 1']"));
    expect(onSelect).toHaveBeenCalledWith(snap.slides[0].id);
  });

  it("draws pins on the slide it shows", () => {
    const { snap } = deck(1);
    const pins = [{ threadId: "t1", x: 0.5, y: 0.5, author: "Grace", authorPhotoUrl: null, replies: 0 }];
    const el = render(createElement(ReadOnlyDeck, {
      slides: snap.slides, themeId: "dali-dark",
      comments: { pageId: "p", viewerId: "u", canComment: false, canModerate: false, pins, focusedPinId: null, onOpenPin: noop, onStart: noop },
    }));
    expect(el.querySelector("[data-comment-pin=t1]")).not.toBeNull();
  });

  it("says so when the deck is empty", () => {
    expect(render(createElement(ReadOnlyDeck, { slides: [], themeId: "dali-dark" })).textContent).toContain("doesn't have any slides");
  });
});

describe("Inspector", () => {
  const base = { themeId: "dali-dark", slideCount: 2, selection: [], editable: true, onLayout: noop, onTheme: noop, onTextStyle: noop, onPickImage: noop, onClearImage: noop };

  it("picks a layout and a theme", () => {
    const { snap } = deck(1);
    const onLayout = vi.fn();
    const onTheme = vi.fn();
    const el = render(createElement(Inspector, { ...base, slide: snap.slides[0], onLayout, onTheme }));
    click([...el.querySelectorAll("[aria-label='Layouts'] button")].find((b) => b.textContent === "Big number") ?? null);
    click([...el.querySelectorAll("[aria-label='Theme'] button")].find((b) => b.textContent === "DALI Light") ?? null);
    expect(onLayout).toHaveBeenCalledWith("bignumber");
    expect(onTheme).toHaveBeenCalledWith("dali-light");
  });

  it("downloads the deck as a PDF from the Deck tab", () => {
    const { snap } = deck(1);
    const onDownloadPdf = vi.fn();
    const el = render(createElement(Inspector, { ...base, slide: snap.slides[0], onDownloadPdf }));
    expect(el.textContent).not.toContain("Download PDF");
    click([...el.querySelectorAll("[aria-label='Inspector'] button")].find((b) => b.textContent === "Deck") ?? null);
    const buttons = [...el.querySelectorAll("button")].filter((b) => b.textContent?.startsWith("Download PDF"));
    click(buttons[0]);
    click(buttons[1]);
    expect(onDownloadPdf.mock.calls).toEqual([[false], [true]]);
  });

  it("offers image controls only on layouts with an image slot", () => {
    const { snap } = deck(1);
    expect(render(createElement(Inspector, { ...base, slide: snap.slides[0] })).textContent).toContain("Add image");
    expect(render(createElement(Inspector, { ...base, slide: { ...snap.slides[0], layoutId: "title" } })).textContent).not.toContain("Add image");
  });

  describe("Appears", () => {
    const withBuilds = (over: Record<string, unknown> = {}) => {
      const { snap } = deck(1);
      const slide = { ...snap.slides[0], layoutId: "content" };
      return { ...base, slide, selection: ["body"], ...over };
    };
    const openText = (el: HTMLElement) => click([...el.querySelectorAll("[role=radio]")].find((b) => b.textContent === "Text") ?? null);

    it("sets the step a text slot appears at and its bullets", () => {
      const onBuild = vi.fn();
      const onBuildBullets = vi.fn();
      const el = render(createElement(Inspector, { ...withBuilds(), onBuild, onBuildBullets }));
      openText(el);
      click(el.querySelector("button[aria-label='Appears']"));
      click([...document.body.querySelectorAll("[role=option]")].find((o) => o.textContent === "Step 2") ?? null);
      expect(onBuild).toHaveBeenCalledWith("body", 2);
      click(el.querySelector("input[role=switch]"));
      expect(onBuildBullets).toHaveBeenCalledWith("body", true);
    });

    it("clears a build with With slide", () => {
      const onBuild = vi.fn();
      const { snap } = deck(1);
      const slide = { ...snap.slides[0], layoutId: "content", elements: snap.slides[0].elements.map((e) => (e.slot === "body" ? { ...e, build: 2 } : e)) };
      const el = render(createElement(Inspector, { ...base, slide, selection: ["body"], onBuild }));
      openText(el);
      expect(el.querySelector("button[aria-label='Appears']")!.textContent).toContain("Step 2");
      click(el.querySelector("button[aria-label='Appears']"));
      click([...document.body.querySelectorAll("[role=option]")].find((o) => o.textContent === "With slide") ?? null);
      expect(onBuild).toHaveBeenCalledWith("body", null);
    });

    it("offers a step past the highest one in use", () => {
      const { snap } = deck(1);
      const slide = { ...snap.slides[0], layoutId: "content", elements: snap.slides[0].elements.map((e) => (e.slot === "body" ? { ...e, build: 3 } : e)) };
      const el = render(createElement(Inspector, { ...base, slide, selection: ["body"], onBuild: vi.fn() }));
      openText(el);
      click(el.querySelector("button[aria-label='Appears']"));
      expect([...document.body.querySelectorAll("[role=option]")].map((o) => o.textContent)).toContain("Step 4");
    });

    it("is read-only when the deck can't be edited, and absent without a handler", () => {
      const el = render(createElement(Inspector, { ...withBuilds({ editable: false }), onBuild: vi.fn() }));
      openText(el);
      expect((el.querySelector("button[aria-label='Appears']") as HTMLButtonElement).disabled).toBe(true);
      const bare = render(createElement(Inspector, withBuilds()));
      openText(bare);
      expect(bare.querySelector("button[aria-label='Appears']")).toBeNull();
    });
  });

  it("offers PowerPoint download and import in the Deck tab, import only to editors", () => {
    const { snap } = deck(1);
    const onImport = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    const open = (props: object) => {
      const el = render(createElement(Inspector, { ...base, slide: snap.slides[0], downloadHref: "/slides/p1/export.pptx", ...props }));
      click([...el.querySelectorAll("[role=radio]")].find((b) => b.textContent === "Deck") ?? null);
      return el;
    };
    const buttons = (el: HTMLElement) => [...el.querySelectorAll("button")].filter((b) => /PowerPoint|Import slides/.test(b.textContent ?? ""));
    const editor = open({ onImport });
    expect(buttons(editor).map((b) => b.textContent)).toEqual(["Download PowerPoint", "Import slides"]);
    click(buttons(editor)[0]);
    expect(assign).toHaveBeenCalledWith("/slides/p1/export.pptx");
    click(buttons(editor)[1]);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(buttons(open({ onImport, editable: false })).map((b) => b.textContent)).toEqual(["Download PowerPoint"]);
    expect(buttons(open({ onImport, importing: true }))[1].hasAttribute("disabled")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("changes the text style of the selected slot", () => {
    const { snap } = deck(1);
    const onTextStyle = vi.fn();
    const el = render(createElement(Inspector, { ...base, slide: snap.slides[0], selection: ["body"], onTextStyle }));
    click([...el.querySelectorAll("[role=radio]")].find((b) => b.textContent === "Text") ?? null);
    click([...el.querySelectorAll("[aria-label='Text style'] button")].find((b) => b.textContent === "Kicker") ?? null);
    expect(onTextStyle).toHaveBeenCalledWith("body", "kicker");
  });
});
