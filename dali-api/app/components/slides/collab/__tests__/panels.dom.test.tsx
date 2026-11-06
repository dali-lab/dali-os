// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { createDeckUndo } from "~/components/slides/deck/deck-undo";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { addFreeImage, addHtml, addShape, addTextBox } from "~/components/slides/deck/freeform-ops";
import { deckMap, initDeck, slidesMap } from "~/components/slides/deck/model";
import { snapshotDeck, type RenderSlide } from "~/components/slides/deck/snapshot";

const h = vi.hoisted(() => ({
  doc: null as unknown as Y.Doc,
  undo: null as unknown,
  toolbar: null as null | Record<string, unknown>,
  inspector: null as null | { tabRequest: number },
  stage: null as null | { freeform: { selection: string[]; editingId: string | null; onSelect: (ids: string[]) => void; onActivate: (id: string, p: { x: number; y: number }) => void; handlers: { format: (id: string) => void } } },
}));

vi.mock("@blocknote/shadcn/style.css", () => ({}));
vi.mock("~/components/doc/theme.css", () => ({}));
vi.mock("../slide-editor.css", () => ({}));
vi.mock("react-router", () => ({ useRevalidator: () => ({ revalidate: vi.fn() }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("../PdfMenuItems", () => ({ DeckPdfMenuItems: () => null }));
vi.mock("~/components/shell/page-bar-slot", () => ({ pageBarTextButton: () => "", PageBarTitle: () => null, PageBarMenuItems: () => null, PageBarPortal: () => null }));
vi.mock("~/components/ui/floating", () => ({ Menu: { Item: () => null } }));
vi.mock("~/components/doc-chrome/PageTitleHeader", () => ({ PageTitleHeader: () => null }));
vi.mock("~/components/shell/PageBarShareButton", () => ({ PageBarShareButton: () => null }));
vi.mock("~/components/sharing/ShareDialog", () => ({ ShareDialog: () => null }));
vi.mock("~/components/collab/PresenceProvider", () => ({ PresenceProvider: (p: { children: React.ReactNode }) => createElement("div", null, p.children) }));
vi.mock("~/components/collab/PresenceBar", () => ({ PresenceBar: () => null }));
vi.mock("~/components/doc/upload", () => ({ uploadEditorImage: vi.fn(), uploadErrorMessage: () => "x", withUploadErrorToast: (f: unknown) => f, IMAGE_UPLOAD_ACCEPT: "image/*" }));
vi.mock("../Filmstrip", () => ({ Filmstrip: () => createElement("div", { "data-testid": "filmstrip" }) }));
vi.mock("../SlideStage", () => ({ SlideStage: (p: never) => ((h.stage = p), createElement("div", { "data-testid": "stage" })), DeletedSlideNotice: () => null, stageKey: (e: number, s: string) => `${e}:${s}` }));
vi.mock("../NotesPane", () => ({ NotesPane: () => null }));
vi.mock("../Inspector", () => ({ Inspector: (p: never) => ((h.inspector = p), createElement("aside", { "data-testid": "inspector" })) }));
vi.mock("../EditorToolbar", () => ({ EditorToolbar: (p: never) => ((h.toolbar = p), createElement("div", { "data-testid": "toolbar" })) }));
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
import { elementActions, findAction, type ElementHandlers } from "../actions";
import { DEFAULT_PANEL_PREFS, PANEL_PREFS_KEY, readPanelPrefs, writePanelPrefs } from "../panel-prefs";
import { comboMatches, keysOf, SHORTCUTS, shortcutFor, shortcutHint } from "../shortcuts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const props = { pageId: "p1", title: "Deck", iconEmoji: null, canEdit: true, canComment: false, canModerateComments: false, canManageAccess: false, workspaceType: "Lab", collab: { token: "t", userId: "u1", userName: "Ada", photoUrl: null } };
const rerender = () => act(() => root.render(createElement(SlidesEditorImpl, { ...props } as never)));
const q = (id: string) => container.querySelector(`[data-testid=${id}]`);
const key = (init: KeyboardEventInit, target: Element = document.body) =>
  act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));
const toggleInspectorKey = (target?: Element) => key({ key: "ˆ", code: "KeyI", metaKey: true, altKey: true }, target);
const focusKey = (target?: Element) => key({ key: "|", code: "Backslash", metaKey: true, shiftKey: true }, target);
const esc = (target?: Element) => key({ key: "Escape" }, target);
const stored = () => JSON.parse(window.localStorage.getItem(PANEL_PREFS_KEY) ?? "null");

function mountWithSlide() {
  const slideId = addSlide(h.doc, "blank", null);
  rerender();
  const shape = addShape(h.doc, slideId, "rect")!;
  const image = addFreeImage(h.doc, slideId, "https://x/y.png", "y")!;
  const text = addTextBox(h.doc, slideId)!;
  rerender();
  const html = addHtml(h.doc, slideId)!;
  rerender();
  return { slideId, shape, image, text, html };
}

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.doc = new Y.Doc();
  initDeck(h.doc);
  const undo = createDeckUndo([slidesMap(h.doc), deckMap(h.doc)]);
  h.undo = { ...undo, setCurrentSlide: vi.fn(), setNavigator: vi.fn(), manager: undo.manager, step: undo.step };
  h.toolbar = null;
  h.inspector = null;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("inspector toggle", () => {
  it("starts with the inspector and slide list shown and focus off", () => {
    mountWithSlide();
    expect(q("inspector")).not.toBeNull();
    expect(q("filmstrip")).not.toBeNull();
    expect(h.toolbar).toMatchObject({ inspectorHidden: false, focus: false });
  });

  it("hides and shows the panel from the toolbar button and from the shortcut", () => {
    mountWithSlide();
    act(() => (h.toolbar!.onToggleInspector as () => void)());
    expect(q("inspector")).toBeNull();
    expect(h.toolbar).toMatchObject({ inspectorHidden: true });
    act(() => (h.toolbar!.onToggleInspector as () => void)());
    expect(q("inspector")).not.toBeNull();
    toggleInspectorKey();
    expect(q("inspector")).toBeNull();
    toggleInspectorKey();
    expect(q("inspector")).not.toBeNull();
  });

  it("does not fire while typing in an input, a textarea, a select or rich text", () => {
    mountWithSlide();
    for (const html of ["<input>", "<textarea></textarea>", "<select></select>", "<div contenteditable='true'><p>x</p></div>"]) {
      const wrap = document.createElement("div");
      wrap.innerHTML = html;
      document.body.appendChild(wrap);
      const target = wrap.querySelector("p, input, textarea, select, div")!;
      toggleInspectorKey(target);
      focusKey(target);
      wrap.remove();
    }
    expect(q("inspector")).not.toBeNull();
    expect(h.toolbar).toMatchObject({ inspectorHidden: false, focus: false });
  });

  it("is not reopened by selecting something", () => {
    const { shape } = mountWithSlide();
    toggleInspectorKey();
    act(() => h.stage!.freeform.onSelect([shape]));
    expect(h.stage!.freeform.selection).toEqual([shape]);
    expect(q("inspector")).toBeNull();
  });

  it("opens on double click of an item with no text editing, and stays closed for text", () => {
    const { shape, image, text } = mountWithSlide();
    toggleInspectorKey();
    act(() => h.stage!.freeform.onActivate(text, { x: 0, y: 0 }));
    expect(q("inspector")).toBeNull();
    act(() => h.stage!.freeform.onActivate(shape, { x: 0, y: 0 }));
    expect(q("inspector")).not.toBeNull();
    expect(h.stage!.freeform.selection).toEqual([shape]);
    const first = h.inspector!.tabRequest;
    toggleInspectorKey();
    act(() => h.stage!.freeform.onActivate(image, { x: 0, y: 0 }));
    expect(q("inspector")).not.toBeNull();
    expect(h.inspector!.tabRequest).toBeGreaterThan(first);
  });

  it("double click on custom HTML starts Interact and leaves a hidden panel hidden", () => {
    const { html } = mountWithSlide();
    toggleInspectorKey();
    act(() => h.stage!.freeform.onActivate(html, { x: 0, y: 0 }));
    expect(h.stage!.freeform.editingId).toBe(html);
    expect(q("inspector")).toBeNull();
  });

  it("Format opens the panel for custom HTML", () => {
    const { html } = mountWithSlide();
    toggleInspectorKey();
    act(() => h.stage!.freeform.handlers.format(html));
    expect(q("inspector")).not.toBeNull();
    expect(h.stage!.freeform.selection).toEqual([html]);
  });

  it("opens from Format for any single item, text included", () => {
    const { text } = mountWithSlide();
    toggleInspectorKey();
    act(() => h.stage!.freeform.handlers.format(text));
    expect(q("inspector")).not.toBeNull();
    expect(h.stage!.freeform.selection).toEqual([text]);
    expect(h.inspector!.tabRequest).toBeGreaterThan(0);
  });
});

describe("focus mode", () => {
  it("hides the inspector, slide list and secondary toolbar groups, then restores them", () => {
    mountWithSlide();
    focusKey();
    expect(q("inspector")).toBeNull();
    expect(q("filmstrip")).toBeNull();
    expect(h.toolbar).toMatchObject({ focus: true });
    focusKey();
    expect(q("inspector")).not.toBeNull();
    expect(q("filmstrip")).not.toBeNull();
    expect(h.toolbar).toMatchObject({ focus: false });
  });

  it("brings back a hidden inspector as hidden", () => {
    mountWithSlide();
    toggleInspectorKey();
    focusKey();
    focusKey();
    expect(q("filmstrip")).not.toBeNull();
    expect(q("inspector")).toBeNull();
  });

  it("ignores the inspector shortcut while focused", () => {
    mountWithSlide();
    focusKey();
    toggleInspectorKey();
    focusKey();
    expect(q("inspector")).not.toBeNull();
  });

  it("exits on Esc only with nothing selected", () => {
    const { shape } = mountWithSlide();
    focusKey();
    act(() => h.stage!.freeform.onSelect([shape]));
    esc();
    expect(h.toolbar).toMatchObject({ focus: true });
    expect(h.stage!.freeform.selection).toEqual([]);
    esc();
    expect(h.toolbar).toMatchObject({ focus: false });
  });

  it("Esc while interacting with custom HTML steps out of Interact and stays in focus", () => {
    const { html } = mountWithSlide();
    focusKey();
    act(() => h.stage!.freeform.onActivate(html, { x: 0, y: 0 }));
    expect(h.stage!.freeform.editingId).toBe(html);
    esc();
    expect(h.stage!.freeform.editingId).toBeNull();
    expect(h.toolbar).toMatchObject({ focus: true });
  });

  it("does not exit on Esc while typing", () => {
    mountWithSlide();
    focusKey();
    const input = document.createElement("input");
    document.body.appendChild(input);
    esc(input);
    input.remove();
    expect(h.toolbar).toMatchObject({ focus: true });
  });

  it("exits from the Exit focus button", () => {
    mountWithSlide();
    focusKey();
    act(() => (h.toolbar!.onExitFocus as () => void)());
    expect(h.toolbar).toMatchObject({ focus: false });
  });

  it("opens the inspector from Format and leaves focus", () => {
    const { shape } = mountWithSlide();
    toggleInspectorKey();
    focusKey();
    act(() => h.stage!.freeform.handlers.format(shape));
    expect(h.toolbar).toMatchObject({ focus: false });
    expect(q("inspector")).not.toBeNull();
  });
});

describe("persistence", () => {
  it("remembers the hidden inspector and focus mode per person", () => {
    mountWithSlide();
    toggleInspectorKey();
    expect(stored()).toEqual({ inspectorHidden: true, focus: false });
    focusKey();
    expect(stored()).toEqual({ inspectorHidden: true, focus: true });
    act(() => root.unmount());
    root = createRoot(container);
    rerender();
    expect(h.toolbar).toMatchObject({ inspectorHidden: true, focus: true });
    expect(q("inspector")).toBeNull();
  });

  it("falls back to the defaults and keeps working when storage throws", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom, clear: boom });
    expect(readPanelPrefs()).toEqual(DEFAULT_PANEL_PREFS);
    expect(() => writePanelPrefs({ inspectorHidden: true, focus: true })).not.toThrow();
    mountWithSlide();
    expect(q("inspector")).not.toBeNull();
    toggleInspectorKey();
    expect(q("inspector")).toBeNull();
  });

  it("ignores junk in storage", () => {
    window.localStorage.setItem(PANEL_PREFS_KEY, "{nope");
    expect(readPanelPrefs()).toEqual(DEFAULT_PANEL_PREFS);
    window.localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ inspectorHidden: "yes", focus: 1 }));
    expect(readPanelPrefs()).toEqual(DEFAULT_PANEL_PREFS);
  });
});

describe("shortcut registry", () => {
  const ev = (init: Partial<KeyboardEvent>) => ({ key: "", code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init });

  it("lists both shortcuts and resolves them by physical key", () => {
    expect(SHORTCUTS.filter((s) => s.group === "View").map((s) => s.id)).toEqual(expect.arrayContaining(["inspector", "focus"]));
    expect(shortcutFor(ev({ key: "ˆ", code: "KeyI", metaKey: true, altKey: true }))).toBe("inspector");
    expect(shortcutFor(ev({ key: "i", code: "KeyI", ctrlKey: true, altKey: true }))).toBe("inspector");
    expect(shortcutFor(ev({ key: "|", code: "Backslash", metaKey: true, shiftKey: true }))).toBe("focus");
  });

  it("does not match near misses, and plain command backslash stays with the app sidebar", () => {
    expect(shortcutFor(ev({ key: "i", code: "KeyI", metaKey: true }))).toBeNull();
    expect(shortcutFor(ev({ key: "i", code: "KeyI", altKey: true }))).toBeNull();
    expect(shortcutFor(ev({ key: "\\", code: "Backslash", metaKey: true }))).toBeNull();
    expect(comboMatches(ev({ key: "z", metaKey: true, altKey: true }), { key: "z", mod: true })).toBe(false);
  });

  it("shows the keys for the sheet and the tooltip", () => {
    expect(keysOf(SHORTCUTS.find((s) => s.id === "inspector")!, true)).toEqual([["⌥", "⌘", "I"]]);
    expect(keysOf(SHORTCUTS.find((s) => s.id === "focus")!, true)).toEqual([["⇧", "⌘", "\\"]]);
    expect(shortcutHint("inspector", true)).toBe("⌥⌘I");
    expect(shortcutHint("inspector", false)).toBe("Alt+Ctrl+I");
  });
});

describe("Format action", () => {
  const handlers = new Proxy({}, { get: (_t, k) => (k === "format" ? format : vi.fn()) }) as unknown as ElementHandlers;
  const format = vi.fn();
  const slide = (): RenderSlide => snapshotDeck(h.doc).slides[0];
  const ctx = (selection: string[]) => ({ slide: slide(), selection, canPaste: false, styleClip: null, canComment: false, handlers });

  it("is in the element menu for one item, text included, and runs with its id", () => {
    const { shape, text } = mountWithSlide();
    for (const id of [shape, text]) {
      const action = findAction(elementActions(ctx([id])), "format")!;
      expect(action.label).toBe("Format…");
      action.run!();
      expect(format).toHaveBeenLastCalledWith(id);
    }
  });

  it("is left out when several items are selected", () => {
    const { shape, image } = mountWithSlide();
    expect(findAction(elementActions(ctx([shape, image])), "format")).toBeUndefined();
  });
});
