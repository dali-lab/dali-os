// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { addSlide, visibleSlideIds } from "~/components/slides/deck/deck-ops";
import { createDeckUndo } from "~/components/slides/deck/deck-undo";
import { addFreeImage } from "~/components/slides/deck/freeform-ops";
import { deckMap, initDeck, slidesMap } from "~/components/slides/deck/model";
import { snapshotDeck } from "~/components/slides/deck/snapshot";

const h = vi.hoisted(() => ({
  doc: null as unknown as Y.Doc,
  undo: null as unknown,
  film: null as null | Record<string, (...a: never[]) => unknown> & { selectedIds: string[] },
  stage: null as null | { zoom: number; freeform: { onDropFiles: (f: File[], at: { x: number; y: number }) => void; selection: string[] } },
  upload: vi.fn(async (f: File) => `https://cdn.example/${f.name}`),
  confirm: vi.fn(async (_: { title: string; tone?: string }) => true),
}));

vi.mock("@blocknote/shadcn/style.css", () => ({}));
vi.mock("~/components/doc/theme.css", () => ({}));
vi.mock("../slide-editor.css", () => ({}));
vi.mock("react-router", () => ({ useRevalidator: () => ({ revalidate: vi.fn() }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: h.confirm }) }));
vi.mock("../PdfMenuItems", () => ({ DeckPdfMenuItems: () => null }));
vi.mock("~/components/shell/page-bar-slot", () => ({
  pageBarTextButton: () => "",
  PageBarTitle: () => null,
  PageBarMenuItems: () => null,
  PageBarPortal: () => null,
}));
vi.mock("~/components/ui/floating", () => ({ Menu: { Item: () => null } }));
vi.mock("~/components/doc-chrome/PageTitleHeader", () => ({ PageTitleHeader: () => null }));
vi.mock("~/components/shell/PageBarShareButton", () => ({ PageBarShareButton: () => null }));
vi.mock("~/components/sharing/ShareDialog", () => ({ ShareDialog: () => null }));
vi.mock("~/components/collab/PresenceProvider", () => ({ PresenceProvider: (p: { children: React.ReactNode }) => createElement("div", null, p.children) }));
vi.mock("~/components/collab/PresenceBar", () => ({ PresenceBar: () => null }));
vi.mock("~/components/doc/upload", () => ({ uploadEditorImage: (f: File) => h.upload(f), uploadErrorMessage: () => "x", withUploadErrorToast: (f: unknown) => f, IMAGE_UPLOAD_ACCEPT: "image/*" }));
vi.mock("../Filmstrip", () => ({ Filmstrip: (p: never) => ((h.film = p), createElement("div")) }));
vi.mock("../SlideStage", () => ({ SlideStage: (p: never) => ((h.stage = p), createElement("div")), DeletedSlideNotice: () => null, stageKey: (e: number, s: string) => `${e}:${s}` }));
vi.mock("../NotesPane", () => ({ NotesPane: () => null }));
vi.mock("../Inspector", () => ({ Inspector: () => null }));
vi.mock("../EditorToolbar", () => ({ EditorToolbar: () => null }));
vi.mock("../ReadOnlyDeck", () => ({ ReadOnlyDeck: () => null }));
vi.mock("../useSlideComments", () => ({ useSlideComments: () => ({ comments: [], error: null, post: vi.fn(), remove: vi.fn() }) }));
vi.mock("../SlideCommentsPanel", () => ({ SlideCommentsPanel: () => null }));
vi.mock("../useDeckDoc", () => ({
  useDeckDoc: () => ({ doc: h.doc, entry: { provider: { awareness: null } }, store: {}, undo: h.undo }),
  useDeckSnapshot: () => snapshotDeck(h.doc),
  useDeckSync: () => ({ state: "saved", synced: true }),
  useUndoState: () => ({ canUndo: false, canRedo: false }),
  useSlidePresence: () => new Map(),
  useSlideDrags: () => ({ peers: new Map(), publish: vi.fn() }),
}));
vi.mock("~/components/slides/deck/deck-undo", async (orig) => ({ ...(await orig<object>()), deckUndoExtension: () => ({}) }));
vi.mock("~/components/slides/deck/deck-ops", async (orig) => ({ ...(await orig<object>()), notesFragment: () => null }));

import SlidesEditorImpl from "../SlidesEditorImpl";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let clipboard = "";

const ids = () => visibleSlideIds(h.doc);
const slides = () => snapshotDeck(h.doc).slides;
const props = { pageId: "p1", title: "Deck", iconEmoji: null, canEdit: true, canComment: true, canModerateComments: false, canManageAccess: false, workspaceType: "Lab", collab: { token: "t", userId: "u1", userName: "Ada", photoUrl: null } };
const rerender = () => act(() => root.render(createElement(SlidesEditorImpl, { ...props } as never)));
const stackSize = () => (h.undo as { manager: Y.UndoManager }).manager.undoStack.length;
const menu = (id: string) => (h.film as unknown as { actionsFor: (id: string) => Array<{ id: string; label: string; run?: () => void; children?: unknown[] }> }).actionsFor(id);
const act1 = (id: string, row: string) => {
  const hit = menu(id).find((a) => a.id === row)!;
  act(() => hit.run!());
  rerender();
};
const select = (id: string, mods = { shift: false, meta: false }) => {
  act(() => (h.film!.onSelect as (id: string, m: typeof mods) => void)(id, mods));
  rerender();
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.doc = new Y.Doc();
  initDeck(h.doc);
  const undo = createDeckUndo([slidesMap(h.doc), deckMap(h.doc)]);
  h.undo = { ...undo, setCurrentSlide: vi.fn(), setNavigator: vi.fn(), manager: undo.manager, step: undo.step };
  clipboard = "";
  vi.stubGlobal("navigator", { clipboard: { writeText: async (t: string) => void (clipboard = t), readText: async () => clipboard } });
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      naturalWidth = 400;
      naturalHeight = 300;
      set src(_: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  h.upload.mockClear();
  h.confirm.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function threeSlides() {
  const a = addSlide(h.doc, "content", null);
  const b = addSlide(h.doc, "content", a);
  const c = addSlide(h.doc, "title", b);
  rerender();
  (h.undo as { manager: Y.UndoManager }).manager.clear();
  return [a, b, c];
}

describe("thumbnail menu in the editor", () => {
  it("skips and unskips a slide, each as one undo step", () => {
    const [a] = threeSlides();
    act1(a, "skip");
    expect(slides()[0].skipped).toBe(true);
    expect(stackSize()).toBe(1);
    expect(menu(a).find((x) => x.id === "skip")!.label).toBe("Unskip slide");
    act1(a, "skip");
    expect(slides()[0].skipped).toBeUndefined();
  });

  it("acts on every selected thumbnail when the clicked one is in the selection", () => {
    const [a, b, c] = threeSlides();
    select(a);
    select(c, { shift: true, meta: false });
    expect(h.film!.selectedIds).toEqual([a, b, c]);
    act1(b, "skip");
    expect(slides().every((s) => s.skipped)).toBe(true);
    expect(stackSize()).toBe(1);
    expect(menu(b).find((x) => x.id === "skip")!.label).toBe("Unskip slides");
  });

  it("acts only on the clicked thumbnail when it is outside the selection", () => {
    const [a, b, c] = threeSlides();
    select(a);
    act1(c, "skip");
    expect(slides().map((s) => !!s.skipped)).toEqual([false, false, true]);
    expect(b).toBeDefined();
  });

  it("asks before deleting the selected slides, then deletes them in one step that undo brings back", async () => {
    const [a, b, c] = threeSlides();
    select(a);
    select(b, { shift: true, meta: false });
    await act(async () => void (await menu(a).find((x) => x.id === "delete")!.run!()));
    expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete 2 slides?", tone: "destructive" }));
    expect(ids()).toEqual([c]);
    expect(stackSize()).toBe(1);
    (h.undo as { manager: Y.UndoManager }).manager.undo();
    expect(ids()).toEqual([a, b, c]);
  });

  it("keeps the slides when the delete is cancelled from the menu", async () => {
    const [a, b, c] = threeSlides();
    h.confirm.mockResolvedValue(false);
    await act(async () => void (await menu(a).find((x) => x.id === "delete")!.run!()));
    expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete this slide?" }));
    expect(ids()).toEqual([a, b, c]);
  });

  it("asks before the filmstrip's delete button removes a slide, and keeps it on cancel", async () => {
    const [a, b, c] = threeSlides();
    h.confirm.mockResolvedValue(false);
    await act(async () => void (await (h.film!.onDelete as unknown as (id: string) => Promise<void>)(b)));
    expect(ids()).toEqual([a, b, c]);
    h.confirm.mockResolvedValue(true);
    await act(async () => void (await (h.film!.onDelete as unknown as (id: string) => Promise<void>)(b)));
    expect(h.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Delete this slide?", tone: "destructive" }));
    expect(ids()).toEqual([a, c]);
  });

  it("changes the layout of every acted-on slide in one step", () => {
    const [a, b] = threeSlides();
    select(a);
    select(b, { shift: true, meta: false });
    const layout = (menu(a).find((x) => x.id === "change-layout")!.children as Array<{ id: string; run: () => void }>).find((x) => x.id === "layout-title")!;
    act(() => layout.run());
    expect(slides().slice(0, 2).map((s) => s.layoutId)).toEqual(["title", "title"]);
    expect(stackSize()).toBe(1);
  });

  it("moves to the top and to the bottom as one step", () => {
    const [a, b, c] = threeSlides();
    act1(c, "move-top");
    expect(ids()).toEqual([c, a, b]);
    expect(stackSize()).toBe(1);
    act1(c, "move-bottom");
    expect(ids()).toEqual([a, b, c]);
  });

  it("adds a slide after the one clicked and duplicates it", () => {
    const [a, b] = threeSlides();
    act1(a, "new-after");
    expect(ids()[0]).toBe(a);
    expect(ids()).toHaveLength(4);
    expect(ids()[2]).toBe(b);
    act1(b, "duplicate");
    expect(ids()).toHaveLength(5);
  });

  it("copies slides to the clipboard and pastes them after another slide", async () => {
    const [a, b, c] = threeSlides();
    await act(async () => menu(a).find((x) => x.id === "copy-slide")!.run!());
    expect(clipboard).toContain("dali-slides-slides");
    await act(async () => menu(c).find((x) => x.id === "paste-slide")!.run!());
    rerender();
    expect(ids()).toHaveLength(4);
    expect(ids().slice(0, 3)).toEqual([a, b, c]);
    expect(slides()[3].layoutId).toBe("content");
  });

  it("ignores text that is not slides when pasting", async () => {
    const [a] = threeSlides();
    clipboard = "just words";
    await act(async () => menu(a).find((x) => x.id === "paste-slide")!.run!());
    expect(ids()).toHaveLength(3);
  });

  it("reorders the selected group by dropping it on another thumbnail", () => {
    const [a, b, c] = threeSlides();
    select(a);
    select(b, { shift: true, meta: false });
    act(() => (h.film!.onMove as (a: string, o: string) => void)(a, c));
    expect(ids()).toEqual([c, a, b]);
    expect(stackSize()).toBe(1);
  });

  it("reorders a single slide by dropping it", () => {
    const [a, b, c] = threeSlides();
    act(() => (h.film!.onMove as (a: string, o: string) => void)(c, a));
    expect(ids()).toEqual([c, a, b]);
  });

  it("offers Comment on a single slide and not on several", () => {
    const [a, b] = threeSlides();
    expect(menu(a).some((x) => x.id === "comment")).toBe(true);
    select(a);
    select(b, { shift: true, meta: false });
    expect(menu(a).some((x) => x.id === "comment")).toBe(false);
  });
});

describe("undoing New slide", () => {
  const manager = () => (h.undo as { manager: Y.UndoManager }).manager;
  const shown = () => (h.stage as unknown as { slide: { id: string } }).slide.id;

  it("tombstones the new slide and does not leave it selected", () => {
    const [a, b, c] = threeSlides();
    act1(a, "new-after");
    const added = ids()[1];
    expect(stackSize()).toBe(1);
    expect(shown()).toBe(added);
    act(() => void manager().undo());
    rerender();
    expect(ids()).toEqual([a, b, c]);
    expect(shown()).toBe(a);
    act(() => void manager().redo());
    rerender();
    expect(ids()[1]).toBe(added);
  });

  it("undoes a duplicated slide and a pasted slide as one step each", async () => {
    const [a, , c] = threeSlides();
    act1(a, "duplicate");
    expect(stackSize()).toBe(1);
    act(() => void manager().undo());
    expect(ids()).toHaveLength(3);
    await act(async () => menu(a).find((x) => x.id === "copy-slide")!.run!());
    manager().clear();
    await act(async () => menu(c).find((x) => x.id === "paste-slide")!.run!());
    expect(stackSize()).toBe(1);
    act(() => void manager().undo());
    expect(ids()).toHaveLength(3);
  });
});

describe("images dropped or pasted on the slide", () => {
  const file = (name: string) => new File(["x"], name, { type: "image/png" });
  const freeImages = () => slides()[0].elements.filter((e) => e.kind === "image" && !e.slot);

  it("adds a dropped image at the drop point, as URL only", async () => {
    threeSlides();
    await act(async () => h.stage!.freeform.onDropFiles([file("a.png")], { x: 1000, y: 600 }));
    const [img] = freeImages();
    expect(img.src).toBe("https://cdn.example/a.png");
    expect(img.x! + img.w! / 2).toBeCloseTo(1000, -1);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(slides())).not.toContain("data:");
  });

  it("replaces the image it lands on instead of adding one, in one undo step", async () => {
    const [a] = threeSlides();
    const id = addFreeImage(h.doc, a, "https://cdn.example/old.png", "old", null, { x: 960, y: 540 })!;
    rerender();
    (h.undo as { manager: Y.UndoManager }).manager.clear();
    await act(async () => h.stage!.freeform.onDropFiles([file("new.png")], { x: 960, y: 540 }));
    expect(freeImages()).toHaveLength(1);
    expect(freeImages()[0]).toMatchObject({ id, src: "https://cdn.example/new.png" });
    expect(stackSize()).toBe(1);
  });

  it("adds several dropped files, stepping each down and right", async () => {
    threeSlides();
    await act(async () => h.stage!.freeform.onDropFiles([file("1.png"), file("2.png")], { x: 600, y: 400 }));
    const [one, two] = freeImages();
    expect(freeImages()).toHaveLength(2);
    expect(two.x! - one.x!).toBeCloseTo(40, 0);
  });

  it("adds nothing when the upload fails", async () => {
    threeSlides();
    h.upload.mockRejectedValueOnce(new Error("nope"));
    await act(async () => h.stage!.freeform.onDropFiles([file("bad.png")], { x: 600, y: 400 }));
    expect(freeImages()).toHaveLength(0);
  });

  it("adds an image pasted from the clipboard at the centre", async () => {
    threeSlides();
    const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    e.clipboardData = { files: [file("p.png")], getData: () => "" };
    await act(async () => void document.body.dispatchEvent(e));
    const [img] = freeImages();
    expect(img.src).toBe("https://cdn.example/p.png");
    expect(img.x! + img.w! / 2).toBeCloseTo(960, -1);
  });
});

describe("zoom keys", () => {
  const press = (key: string, init: KeyboardEventInit = {}) =>
    act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true, cancelable: true, ...init })));

  it("steps in and out and fits with Command plus, minus and zero", () => {
    threeSlides();
    expect(h.stage!.zoom).toBe(1);
    press("=");
    expect(h.stage!.zoom).toBe(1.25);
    press("+");
    expect(h.stage!.zoom).toBe(1.5);
    press("-");
    expect(h.stage!.zoom).toBe(1.25);
    press("0");
    expect(h.stage!.zoom).toBe(1);
  });

  it("stops the browser's own zoom", () => {
    threeSlides();
    const e = new KeyboardEvent("keydown", { key: "=", metaKey: true, bubbles: true, cancelable: true });
    act(() => void document.body.dispatchEvent(e));
    expect(e.defaultPrevented).toBe(true);
  });
});
