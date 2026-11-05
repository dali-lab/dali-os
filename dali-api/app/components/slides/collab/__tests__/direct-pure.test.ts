import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { addFreeImage, addShape, addTextBox, setLocked, setPlacements } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";
import { snapshotDeck, type RenderSlide } from "~/components/slides/deck/snapshot";
import { setBuild } from "~/components/slides/deck/deck-ops";
import { actionIds, arrangeActions, elementActions, findAction, stageActions, thumbnailActions, type ActionSpec, type ElementHandlers, type StageHandlers, type ThumbnailHandlers } from "../actions";
import { neededHeight } from "../auto-height";
import { actingSet, dropIndex, nextThumbSelection } from "../filmstrip-select";
import { hasFiles, imageFilesOf, imageUnder, planDrop } from "../drop-images";
import { contextSelection, IDLE, reduceEditing, type EditFacts, type EditState } from "../editing-model";
import { formatWholeText, placeCaretAt, registerTextEditor } from "../text-format";
import { clampZoom, clientToUnits, pinchZoom, ZOOM_MAX, ZOOM_MIN, zoomIn, zoomKey, zoomLabel, zoomOut } from "../zoom";

function setup(layout = "blank") {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, layout, null);
  const slide = (): RenderSlide => snapshotDeck(doc).slides.find((s) => s.id === slideId)!;
  return { doc, slideId, slide };
}

const handlers = (): ElementHandlers =>
  new Proxy({} as ElementHandlers, {
    get: (target, key: string) => ((target as unknown as Record<string, unknown>)[key] ??= vi.fn()),
  });
const labels = (list: ActionSpec[]) => list.map((a) => a.label);
const ctx = (slide: RenderSlide, selection: string[], over: Partial<Parameters<typeof elementActions>[0]> = {}) => ({
  slide,
  selection,
  canPaste: true,
  styleClip: null,
  canComment: true,
  handlers: handlers(),
  ...over,
});

describe("element menu", () => {
  it("offers the full set for one text box", () => {
    const { doc, slideId, slide } = setup();
    const id = addTextBox(doc, slideId)!;
    const list = elementActions(ctx(slide(), [id]));
    expect(labels(list)).toEqual(["Cut", "Copy", "Paste", "Duplicate", "Delete", "Copy style", "Paste style", "Arrange", "Align to slide", "Lock", "Add link", "Add build", "Comment"]);
    expect(findAction(list, "arrange")!.children!.map((a) => a.label)).toEqual(["Bring to front", "Bring forward", "Send backward", "Send to back"]);
    expect(findAction(list, "align")!.children!.map((a) => a.label)).toEqual(["Left", "Center", "Right", "Top", "Middle", "Bottom"]);
    expect(findAction(list, "delete")!.destructive).toBe(true);
    expect(findAction(list, "cut")!.shortcut).toBe("⌘X");
  });

  it("adds image actions only for an image", () => {
    const { doc, slideId, slide } = setup();
    const img = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    const shape = addShape(doc, slideId, "rect")!;
    expect(labels(elementActions(ctx(slide(), [img])))).toEqual(expect.arrayContaining(["Replace image", "Crop", "Reset size"]));
    const forShape = actionIds(elementActions(ctx(slide(), [shape])));
    expect(forShape).not.toContain("crop");
    expect(forShape).not.toContain("add-link");
  });

  it("aligns to the selection when several are selected and offers Group, not Ungroup", () => {
    const { doc, slideId, slide } = setup();
    const a = addShape(doc, slideId, "rect")!;
    const b = addShape(doc, slideId, "ellipse")!;
    const h = handlers();
    const list = elementActions(ctx(slide(), [a, b], { handlers: h }));
    expect(findAction(list, "align")!.label).toBe("Align to selection");
    findAction(list, "align-left")!.run!();
    expect(h.align).toHaveBeenCalledWith("left", "selection");
    expect(actionIds(list)).toContain("group");
    expect(actionIds(list)).not.toContain("ungroup");
    expect(actionIds(list)).not.toContain("comment");
    expect(actionIds(list)).not.toContain("crop");
  });

  it("offers Ungroup for a group", () => {
    const { doc, slideId, slide } = setup();
    const a = addShape(doc, slideId, "rect")!;
    const b = addShape(doc, slideId, "ellipse")!;
    const h = handlers();
    h.group();
    const grouped = { ...slide(), elements: [...slide().elements, { id: "g", kind: "group", slot: null, z: 9, blocks: [], src: null, alt: null, textStyle: null, children: [a, b] }] } as RenderSlide;
    expect(actionIds(elementActions(ctx(grouped, ["g"])))).toContain("ungroup");
  });

  it("switches Lock to Unlock and disables edits for locked elements", () => {
    const { doc, slideId, slide } = setup();
    const id = addShape(doc, slideId, "rect")!;
    setLocked(doc, slideId, [id], true);
    const list = elementActions(ctx(slide(), [id]));
    expect(findAction(list, "unlock")).toBeDefined();
    expect(findAction(list, "lock")).toBeUndefined();
    expect(findAction(list, "cut")!.disabled).toBe(true);
    expect(findAction(list, "delete")!.disabled).toBe(true);
    expect(findAction(list, "arrange")!.children!.every((a) => a.disabled)).toBe(true);
    expect(findAction(list, "align")!.disabled).toBe(true);
    expect(findAction(list, "copy")!.disabled).toBeUndefined();
  });

  it("offers Snap back only for a detached slot element, and Remove build once built", () => {
    const { doc, slideId, slide } = setup("content");
    const body = slide().elements.find((e) => e.slot === "title")!;
    expect(actionIds(elementActions(ctx(slide(), [body.id])))).not.toContain("snap-back");
    setPlacements(doc, slideId, { [body.id]: { x: 10, y: 10, w: 400, h: 100, rot: 0 } });
    expect(actionIds(elementActions(ctx(slide(), [body.id])))).toContain("snap-back");
    setBuild(doc, slideId, body.id, 1);
    expect(findAction(elementActions(ctx(slide(), [body.id])), "build")!.label).toBe("Remove build");
  });

  it("disables Paste without a clipboard, Paste style without a matching style, and hides Comment when commenting is off", () => {
    const { doc, slideId, slide } = setup();
    const text = addTextBox(doc, slideId)!;
    const shape = addShape(doc, slideId, "rect")!;
    const list = elementActions(ctx(slide(), [text], { canPaste: false, styleClip: "shape", canComment: false }));
    expect(findAction(list, "paste")!.disabled).toBe(true);
    expect(findAction(list, "paste-style")!.disabled).toBe(true);
    expect(actionIds(list)).not.toContain("comment");
    expect(findAction(elementActions(ctx(slide(), [shape], { styleClip: "shape" })), "paste-style")!.disabled).toBe(false);
  });

  it("runs the matching handler for each row", () => {
    const { doc, slideId, slide } = setup();
    const id = addTextBox(doc, slideId)!;
    const h = handlers();
    const list = elementActions(ctx(slide(), [id], { handlers: h }));
    for (const [row, fn] of [["cut", "cut"], ["copy", "copy"], ["paste", "paste"], ["duplicate", "duplicate"], ["delete", "remove"], ["copy-style", "copyStyle"], ["paste-style", "pasteStyle"]] as const) {
      const action = findAction(list, row)!;
      if (action.disabled) continue;
      action.run!();
      expect(h[fn as keyof ElementHandlers]).toHaveBeenCalled();
    }
    findAction(list, "arrange-front")!.run!();
    expect(h.reorder).toHaveBeenCalledWith("front");
    findAction(list, "lock")!.run!();
    expect(h.lock).toHaveBeenCalledWith(true);
    findAction(list, "add-link")!.run!();
    expect(h.addLink).toHaveBeenCalledWith(id);
    findAction(list, "comment")!.run!();
    expect(h.comment).toHaveBeenCalledWith(id);
  });

  it("gives the format bar's arrange menu the same rows as the context menu's Arrange", () => {
    const h = handlers();
    expect(arrangeActions(h).map((a) => a.id)).toEqual(["arrange-front", "arrange-forward", "arrange-backward", "arrange-back"]);
    const { doc, slideId, slide } = setup();
    const id = addShape(doc, slideId, "rect")!;
    const fromMenu = findAction(elementActions(ctx(slide(), [id], { handlers: h })), "arrange")!.children!;
    expect(fromMenu.map((a) => [a.id, a.label, a.shortcut])).toEqual(arrangeActions(h).map((a) => [a.id, a.label, a.shortcut]));
  });

  it("is empty when nothing real is selected", () => {
    const { slide } = setup();
    expect(elementActions(ctx(slide(), ["ghost"]))).toEqual([]);
  });
});

describe("stage menu", () => {
  const sh = (): StageHandlers => ({
    paste: vi.fn(), addText: vi.fn(), addShape: vi.fn(), addImage: vi.fn(), changeLayout: vi.fn(), selectAll: vi.fn(), comment: vi.fn(), setGuides: vi.fn(), setGrid: vi.fn(),
  });
  const base = (h: StageHandlers, over = {}) => stageActions({ layoutId: "content", canPaste: true, canComment: true, guides: true, grid: false, handlers: h, ...over });

  it("lists paste here, the adders, layouts, select all, comment and the snap toggles", () => {
    const list = base(sh());
    expect(labels(list)).toEqual(["Paste here", "Add text box here", "Add shape here", "Add image here", "Change layout", "Select all", "Comment here", "Show guides", "Show grid"]);
    expect(findAction(list, "add-shape")!.children!.map((a) => a.label)).toEqual(["Rectangle", "Rounded rectangle", "Ellipse", "Line", "Arrow"]);
  });

  it("checks the current layout, and flips each toggle", () => {
    const h = sh();
    const list = base(h);
    const layouts = findAction(list, "change-layout")!.children!;
    expect(layouts.filter((l) => l.checked).map((l) => l.id)).toEqual(["layout-content"]);
    layouts.find((l) => l.id === "layout-title")!.run!();
    expect(h.changeLayout).toHaveBeenCalledWith("title");
    expect(findAction(list, "guides")!.checked).toBe(true);
    findAction(list, "guides")!.run!();
    expect(h.setGuides).toHaveBeenCalledWith(false);
    findAction(list, "grid")!.run!();
    expect(h.setGrid).toHaveBeenCalledWith(true);
    findAction(list, "add-shape-ellipse")!.run!();
    expect(h.addShape).toHaveBeenCalledWith("ellipse");
  });

  it("disables Paste here without a clipboard and hides Comment here when commenting is off", () => {
    const list = base(sh(), { canPaste: false, canComment: false });
    expect(findAction(list, "paste-here")!.disabled).toBe(true);
    expect(actionIds(list)).not.toContain("comment-here");
  });
});

describe("thumbnail menu", () => {
  const th = (): ThumbnailHandlers => ({ newAfter: vi.fn(), duplicate: vi.fn(), remove: vi.fn(), skip: vi.fn(), changeLayout: vi.fn(), copy: vi.fn(), paste: vi.fn(), moveTo: vi.fn(), comment: vi.fn() });
  const slides = (): RenderSlide[] => {
    const doc = new Y.Doc();
    initDeck(doc);
    const a = addSlide(doc, "content", null);
    addSlide(doc, "title", a);
    return snapshotDeck(doc).slides;
  };
  const make = (over: Partial<Parameters<typeof thumbnailActions>[0]> = {}, h = th()) => {
    const s = slides();
    return thumbnailActions({ targets: [s[0]], index: 0, count: 2, canPaste: true, canComment: true, handlers: h, ...over });
  };

  it("lists slide actions, with Move to top disabled on the first slide", () => {
    const list = make();
    expect(labels(list)).toEqual(["New slide after", "Duplicate slide", "Delete slide", "Skip slide", "Change layout", "Copy slide", "Paste slide", "Move to top", "Move to bottom", "Comment"]);
    expect(findAction(list, "move-top")!.disabled).toBe(true);
    expect(findAction(list, "move-bottom")!.disabled).toBe(false);
    expect(findAction(list, "delete")!.destructive).toBe(true);
  });

  it("says Unskip for a skipped slide and acts on it", () => {
    const s = slides();
    const h = th();
    const list = thumbnailActions({ targets: [{ ...s[0], skipped: true }], index: 0, count: 2, canPaste: true, canComment: false, handlers: h });
    expect(findAction(list, "skip")!.label).toBe("Unskip slide");
    findAction(list, "skip")!.run!();
    expect(h.skip).toHaveBeenCalledWith(false);
    expect(actionIds(list)).not.toContain("comment");
  });

  it("pluralizes for several slides, drops Comment, and checks a shared layout", () => {
    const s = slides();
    const list = thumbnailActions({ targets: s, index: 0, count: 2, canPaste: true, canComment: true, handlers: th() });
    expect(findAction(list, "duplicate")!.label).toBe("Duplicate slides");
    expect(findAction(list, "delete")!.label).toBe("Delete slides");
    expect(actionIds(list)).not.toContain("comment");
    expect(findAction(list, "move-top")!.disabled).toBe(false);
    expect(findAction(list, "change-layout")!.children!.some((c) => c.checked)).toBe(false);
  });

  it("checks the layout of a single slide and runs move, copy and paste", () => {
    const h = th();
    const list = make({}, h);
    expect(findAction(list, "layout-content")!.checked).toBe(true);
    findAction(list, "move-bottom")!.run!();
    expect(h.moveTo).toHaveBeenCalledWith("bottom");
    findAction(list, "copy-slide")!.run!();
    findAction(list, "paste-slide")!.run!();
    expect(h.copy).toHaveBeenCalled();
    expect(h.paste).toHaveBeenCalled();
    expect(findAction(make({ canPaste: false }), "paste-slide")!.disabled).toBe(true);
  });
});

describe("editing model", () => {
  const facts: EditFacts = {
    kindOf: (id) => ({ t: "text", i: "image", s: "shape" })[id],
    locked: (id) => id === "L",
  };
  const step = (state: EditState, event: Parameters<typeof reduceEditing>[1]) => reduceEditing(state, event, { ...facts, kindOf: (id) => (id === "L" ? "text" : facts.kindOf(id)) });

  it("a click selects without editing", () => {
    expect(step(IDLE, { type: "click", id: "t" })).toEqual({ selection: ["t"], editingId: null, cropId: null });
  });
  it("a shift click toggles", () => {
    const one = step(IDLE, { type: "click", id: "t" });
    const two = step(one, { type: "click", id: "s", shift: true });
    expect(two.selection).toEqual(["t", "s"]);
    expect(step(two, { type: "click", id: "t", shift: true }).selection).toEqual(["s"]);
  });
  it("a double click goes inside: text edits, an image crops, a shape just selects, a locked text box does nothing", () => {
    expect(step(IDLE, { type: "dblclick", id: "t" })).toEqual({ selection: ["t"], editingId: "t", cropId: null });
    expect(step(IDLE, { type: "dblclick", id: "i" })).toEqual({ selection: ["i"], editingId: null, cropId: "i" });
    expect(step(IDLE, { type: "dblclick", id: "s" })).toEqual({ selection: ["s"], editingId: null, cropId: null });
    expect(step(IDLE, { type: "dblclick", id: "L" })).toEqual({ selection: ["L"], editingId: null, cropId: null });
  });
  it("Enter edits a single selected text box and ignores several", () => {
    expect(step({ ...IDLE, selection: ["t"] }, { type: "enter" })).toEqual({ selection: ["t"], editingId: "t", cropId: null });
    const multi = { ...IDLE, selection: ["t", "s"] };
    expect(step(multi, { type: "enter" })).toBe(multi);
  });
  it("Enter does nothing while already inside", () => {
    const inside = { selection: ["t"], editingId: "t", cropId: null };
    expect(step(inside, { type: "enter" })).toBe(inside);
  });
  it("Escape steps out to the element, then deselects", () => {
    const editing = { selection: ["t"], editingId: "t", cropId: null };
    const out = step(editing, { type: "escape" });
    expect(out).toEqual({ selection: ["t"], editingId: null, cropId: null });
    expect(step(out, { type: "escape" })).toEqual(IDLE);
  });
  it("Escape leaves crop first", () => {
    const cropping = { selection: ["i"], editingId: null, cropId: "i" };
    expect(step(cropping, { type: "escape" })).toEqual({ selection: ["i"], editingId: null, cropId: null });
  });
  it("the background clears everything, or keeps the selection with shift", () => {
    const state = { selection: ["t"], editingId: "t", cropId: null };
    expect(step(state, { type: "background" })).toEqual(IDLE);
    expect(step(state, { type: "background", shift: true })).toEqual({ selection: ["t"], editingId: null, cropId: null });
  });
  it("a right click keeps a selection it lands in and replaces one it misses", () => {
    expect(contextSelection(["a", "b"], "b")).toEqual(["a", "b"]);
    expect(contextSelection(["a", "b"], "c")).toEqual(["c"]);
    expect(contextSelection([], "c")).toEqual(["c"]);
  });
});

describe("zoom", () => {
  it("steps through the presets and stops at the ends", () => {
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomIn(ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(zoomOut(ZOOM_MIN)).toBe(ZOOM_MIN);
    expect(zoomIn(1.1)).toBe(1.25);
    expect(zoomOut(1.1)).toBe(1);
  });
  it("clamps and labels", () => {
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(zoomLabel(1.25)).toBe("125%");
  });
  it("pinches in and out from the wheel delta", () => {
    expect(pinchZoom(1, -10)).toBeGreaterThan(1);
    expect(pinchZoom(1, 10)).toBeLessThan(1);
    expect(pinchZoom(ZOOM_MAX, -100)).toBe(ZOOM_MAX);
  });
  it("reads the zoom shortcuts with Command or Control and not with Option", () => {
    const k = (key: string, over = {}) => zoomKey({ key, metaKey: true, ctrlKey: false, altKey: false, ...over });
    expect(k("=")).toBe("in");
    expect(k("+")).toBe("in");
    expect(k("-")).toBe("out");
    expect(k("0")).toBe("fit");
    expect(k("=", { altKey: true })).toBeNull();
    expect(k("a")).toBeNull();
    expect(zoomKey({ key: "=", metaKey: false, ctrlKey: false, altKey: false })).toBeNull();
  });
  it("maps a screen point to slide units the same at any zoom", () => {
    const stage = { w: 1920, h: 1080 };
    expect(clientToUnits({ x: 500, y: 300 }, { left: 100, top: 100, width: 800, height: 450 }, stage)).toEqual({ x: 960, y: 480 });
    expect(clientToUnits({ x: 500, y: 300 }, { left: 100, top: 100, width: 1600, height: 900 }, stage)).toEqual({ x: 480, y: 240 });
    expect(clientToUnits({ x: -100, y: 100 }, { left: -100, top: 0, width: 960, height: 540 }, stage)).toEqual({ x: 0, y: 200 });
  });
});

describe("dropping images", () => {
  const file = (type: string, name = "a") => new File(["x"], name, { type });
  it("keeps only real image files", () => {
    const files = [file("image/png"), file("application/pdf"), file("image/svg+xml"), file("image/webp")];
    expect(imageFilesOf({ files } as unknown as DataTransfer).map((f) => f.type)).toEqual(["image/png", "image/webp"]);
    expect(imageFilesOf(null)).toEqual([]);
    expect(hasFiles({ types: ["Files"] })).toBe(true);
    expect(hasFiles({ types: ["text/plain"] })).toBe(false);
  });
  it("finds the topmost free image under the point and skips locked, slot and non-image elements", () => {
    const { doc, slideId, slide } = setup();
    const back = addFreeImage(doc, slideId, "https://x/a.png", "a", null, { x: 960, y: 540 })!;
    const front = addFreeImage(doc, slideId, "https://x/b.png", "b", null, { x: 960, y: 540 })!;
    expect(imageUnder(slide(), { x: 960, y: 540 })).toBe(front);
    setLocked(doc, slideId, [front], true);
    expect(imageUnder(slide(), { x: 960, y: 540 })).toBe(back);
    expect(imageUnder(slide(), { x: 5, y: 5 })).toBeNull();
    addShape(doc, slideId, "rect", { x: 100, y: 100 });
    expect(imageUnder(slide(), { x: 100, y: 100 })).toBeNull();
  });
  it("plans the first file to replace the image it lands on and the rest to be added, stepped", () => {
    const { doc, slideId, slide } = setup();
    const img = addFreeImage(doc, slideId, "https://x/a.png", "a", null, { x: 960, y: 540 })!;
    const plan = planDrop(slide(), [file("image/png", "1"), file("image/png", "2")], { x: 960, y: 540 });
    expect(plan[0].replaceId).toBe(img);
    expect(plan[1].replaceId).toBeNull();
    expect(plan[1].at).toEqual({ x: 1000, y: 580 });
    expect(planDrop(slide(), [file("image/png")], { x: 5, y: 5 })[0].replaceId).toBeNull();
  });
});

describe("thumbnail selection", () => {
  const order = ["a", "b", "c", "d", "e"];
  const none = { selected: [], anchor: null };
  it("selects one on a plain click and ranges from the anchor on shift", () => {
    const one = nextThumbSelection(order, none, "b", { shift: false, meta: false });
    expect(one).toEqual({ selected: ["b"], anchor: "b" });
    expect(nextThumbSelection(order, one, "d", { shift: true, meta: false }).selected).toEqual(["b", "c", "d"]);
    expect(nextThumbSelection(order, { selected: ["d"], anchor: "d" }, "b", { shift: true, meta: false }).selected).toEqual(["b", "c", "d"]);
  });
  it("toggles on meta, in deck order", () => {
    const s = nextThumbSelection(order, { selected: ["d"], anchor: "d" }, "b", { shift: false, meta: true });
    expect(s.selected).toEqual(["b", "d"]);
    expect(nextThumbSelection(order, s, "d", { shift: false, meta: true }).selected).toEqual(["b"]);
  });
  it("acts on the whole selection when the grabbed slide is in it, else on the grabbed slide", () => {
    expect(actingSet(order, ["d", "b"], "d")).toEqual(["b", "d"]);
    expect(actingSet(order, ["d", "b"], "a")).toEqual(["a"]);
  });
  it("finds the drop index among the slides left behind", () => {
    expect(dropIndex(order, ["a", "b"], "d")).toBe(2);
    expect(dropIndex(order, ["d", "e"], "b")).toBe(1);
    expect(dropIndex(order, ["b"], "b")).toBeNull();
    expect(dropIndex(order, ["a"], "zzz")).toBeNull();
    expect(dropIndex(order, ["a", "b"], "e")).toBe(3);
  });
});

describe("auto height measurement", () => {
  it("is null while the text fits and the box height in slide units once it does not", () => {
    expect(neededHeight({ scrollHeight: 100, clientHeight: 100, offsetWidth: 500 }, 720)).toBeNull();
    expect(neededHeight({ scrollHeight: 200, clientHeight: 100, offsetWidth: 360 }, 720)).toBe(400);
    expect(neededHeight({ scrollHeight: 200, clientHeight: 100, offsetWidth: 0 }, 720)).toBeNull();
  });
});

describe("text format", () => {
  const fake = () => {
    const calls: string[] = [];
    const doc = [{ type: "paragraph" }, { type: "paragraph" }];
    return {
      calls,
      editor: {
        document: doc,
        focus: () => calls.push("focus"),
        toggleStyles: (s: Record<string, boolean>) => calls.push(`toggle:${Object.keys(s)[0]}`),
        updateBlock: (_b: unknown, u: { type: string }) => calls.push(`block:${u.type}`),
        _tiptapEditor: { commands: { selectAll: () => calls.push("selectAll") } },
      },
    };
  };
  it("selects all text then toggles a style", () => {
    const { editor, calls } = fake();
    registerTextEditor("t1", editor);
    expect(formatWholeText("t1", "bold")).toBe(true);
    expect(calls).toEqual(["focus", "selectAll", "toggle:bold"]);
  });
  it("turns every block into a bullet, and back when all already are", () => {
    const { editor, calls } = fake();
    registerTextEditor("t2", editor);
    formatWholeText("t2", "bullet");
    expect(calls.filter((c) => c.startsWith("block"))).toEqual(["block:bulletListItem", "block:bulletListItem"]);
    editor.document.forEach((b) => (b.type = "bulletListItem"));
    calls.length = 0;
    formatWholeText("t2", "bullet");
    expect(calls.filter((c) => c.startsWith("block"))).toEqual(["block:paragraph", "block:paragraph"]);
  });
  it("selects the text for a link without changing it", () => {
    const { editor, calls } = fake();
    registerTextEditor("t3", editor);
    expect(formatWholeText("t3", "link")).toBe(true);
    expect(calls).toEqual(["focus", "selectAll"]);
  });
  it("reports false for an unknown box or an editor that throws", () => {
    expect(formatWholeText("missing", "bold")).toBe(false);
    registerTextEditor("boom", { document: [], focus: () => { throw new Error("x"); } });
    expect(formatWholeText("boom", "bold")).toBe(false);
  });
});
