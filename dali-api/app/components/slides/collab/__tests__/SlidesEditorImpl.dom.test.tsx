// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DeckSnapshot } from "~/components/slides/deck/snapshot";

const h = vi.hoisted(() => ({ snap: null as unknown, presenceProps: null as unknown, titleHeader: null as null | { canEdit: boolean; onRename: (n: string) => Promise<void>; onIconChange: (e: string | null) => void } }));

vi.mock("@blocknote/shadcn/style.css", () => ({}));
vi.mock("~/components/doc/theme.css", () => ({}));
vi.mock("../slide-editor.css", () => ({}));
vi.mock("react-router", () => ({ useRevalidator: () => ({ revalidate: vi.fn() }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("../PdfMenuItems", () => ({
  DeckPdfMenuItems: (p: { pageId: string; canExportNotes: boolean }) => createElement("i", { "data-pdf-menu": `${p.pageId}|${p.canExportNotes}` }),
}));
vi.mock("~/components/shell/page-bar-slot", () => ({
  pageBarTextButton: () => "",
  PageBarTitle: () => null,
  PageBarMenuItems: ({ children }: { children: React.ReactNode }) => createElement("div", { "data-menu-items": "" }, children),
  PageBarPortal: ({ slot, children }: { slot: string; children: React.ReactNode }) => createElement("div", { "data-slot-name": slot }, children),
}));
vi.mock("~/components/ui/floating", () => ({
  Menu: {
    Item: (p: { children: React.ReactNode; onSelect: () => void; disabled?: boolean }) =>
      createElement("button", { type: "button", disabled: p.disabled, onClick: p.onSelect }, p.children),
  },
}));
vi.mock("~/components/doc-chrome/PageTitleHeader", () => ({ PageTitleHeader: (p: NonNullable<typeof h.titleHeader>) => ((h.titleHeader = p), null) }));
vi.mock("~/components/shell/PageBarShareButton", () => ({ PageBarShareButton: () => null }));
vi.mock("~/components/sharing/ShareDialog", () => ({ ShareDialog: () => null }));
vi.mock("~/components/collab/PresenceProvider", () => ({
  PresenceProvider: (p: { pageId: string; children: React.ReactNode }) => ((h.presenceProps = p), createElement("div", null, p.children)),
}));
vi.mock("~/components/collab/PresenceBar", () => ({ PresenceBar: () => createElement("span", { "data-testid": "presence-bar" }) }));
vi.mock("~/components/doc/upload", () => ({ uploadEditorImage: vi.fn(), uploadErrorMessage: () => "Upload failed", withUploadErrorToast: (f: unknown) => f, IMAGE_UPLOAD_ACCEPT: "image/*" }));
vi.mock("../Filmstrip", () => ({ Filmstrip: () => createElement("div", { "data-testid": "filmstrip" }) }));
vi.mock("../SlideStage", () => ({ SlideStage: () => createElement("div", { "data-testid": "stage" }), DeletedSlideNotice: () => null, stageKey: (e: number, s: string) => `${e}:${s}` }));
vi.mock("../NotesPane", () => ({ NotesPane: () => null }));
vi.mock("../Inspector", () => ({ Inspector: () => null }));
vi.mock("../EditorToolbar", () => ({ EditorToolbar: () => createElement("div", { "data-testid": "toolbar" }) }));
vi.mock("../ReadOnlyDeck", () => ({
  ReadOnlyDeck: (p: { slides: unknown[]; notice?: string; currentId?: string | null }) =>
    createElement("div", { "data-testid": "read-only", "data-current": p.currentId ?? "" }, `${p.slides.length}|${p.notice ?? ""}`),
}));
vi.mock("../useSlideComments", () => ({ useSlideComments: () => ({ comments: [], error: null, post: vi.fn(), remove: vi.fn() }) }));
vi.mock("../SlideCommentsPanel", () => ({
  SlideCommentsPanel: (p: { focusThreadId: string | null }) => createElement("aside", { "data-testid": "comments-panel", "data-focus": p.focusThreadId ?? "" }),
}));
vi.mock("../useDeckDoc", () => ({
  useDeckDoc: () => ({ doc: {}, entry: {}, store: {}, undo: { manager: {}, setCurrentSlide: vi.fn(), setNavigator: vi.fn() } }),
  useDeckSnapshot: () => h.snap,
  useDeckSync: () => ({ state: "saved", synced: true }),
  useUndoState: () => ({ canUndo: false, canRedo: false }),
  useSlidePresence: () => new Map(),
  useSlideDrags: () => ({ peers: new Map(), publish: vi.fn() }),
}));
vi.mock("~/components/slides/deck/deck-undo", () => ({ deckUndoExtension: () => ({}) }));
vi.mock("~/components/slides/deck/deck-ops", async (orig) => ({ ...(await orig<object>()), notesFragment: () => null }));

import SlidesEditorImpl from "../SlidesEditorImpl";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snap = (v: unknown): DeckSnapshot => ({
  v,
  themeId: "dali-dark",
  epoch: 0,
  slides: [
    { id: "a", pos: 1, layoutId: "content", elements: [] },
    { id: "b", pos: 2, layoutId: "content", elements: [] },
  ],
  deletedIds: [],
  deletedBy: {},
});
const props = (canEdit: boolean, extra: Record<string, unknown> = {}) => ({
  pageId: "p1",
  title: "Deck",
  iconEmoji: null,
  canEdit,
  canComment: false,
  canModerateComments: false,
  ...extra,
  canManageAccess: false,
  workspaceType: "Lab",
  collab: { token: "t", userId: "u1", userName: "Ada", photoUrl: null },
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
});
const render = (canEdit: boolean, extra: Record<string, unknown> = {}) => {
  act(() => root.render(createElement(SlidesEditorImpl, props(canEdit, extra) as never)));
  return container;
};

describe("SlidesEditorImpl", () => {
  it("gives an editor the full editor", () => {
    h.snap = snap(1);
    const el = render(true);
    expect(el.querySelector("[data-testid=toolbar]")).not.toBeNull();
    expect(el.querySelector("[data-testid=read-only]")).toBeNull();
  });

  it("shows the deck title on the page, editable only by an editor", () => {
    h.snap = snap(1);
    render(true);
    expect(h.titleHeader!.canEdit).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    render(false);
    expect(h.titleHeader!.canEdit).toBe(false);
  });

  it("saves a rename and an icon from the page title through /api/documents/:id", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    h.snap = snap(1);
    render(true);
    await act(async () => {
      await h.titleHeader!.onRename("Q3 review");
      h.titleHeader!.onIconChange("🚀");
    });
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string));
    expect(bodies).toEqual([{ title: "Q3 review" }, { iconEmoji: "🚀" }]);
    vi.unstubAllGlobals();
  });

  it("offers PowerPoint download to everyone and import only to editors", () => {
    h.snap = snap(1);
    const menu = (el: HTMLElement) => [...el.querySelectorAll("[data-menu-items] button")].map((b) => b.textContent);
    expect(menu(render(true))).toEqual(["Download PowerPoint", "Import slides", "Find and replace", "Keyboard shortcuts"]);
    act(() => root.unmount());
    root = createRoot(container);
    expect(menu(render(false))).toEqual(["Download PowerPoint"]);
  });

  it("gives a viewer the live deck read-only, without an unknown-version notice", () => {
    h.snap = snap(1);
    const el = render(false);
    expect(el.querySelector("[data-testid=toolbar]")).toBeNull();
    expect(el.querySelector("[data-testid=read-only]")!.textContent).toBe("2|");
  });

  it("adds the PDF download to the page bar menu, with notes only for editors", () => {
    h.snap = snap(1);
    expect(render(true).querySelector("[data-pdf-menu]")!.getAttribute("data-pdf-menu")).toBe("p1|true");
    expect(render(false).querySelector("[data-pdf-menu]")!.getAttribute("data-pdf-menu")).toBe("p1|false");
  });

  it("explains an unknown version to everyone", () => {
    h.snap = snap(2);
    expect(render(true).querySelector("[data-testid=read-only]")!.textContent).toContain("newer version of Slides");
  });

  it("puts page presence in the page bar's presence slot", () => {
    h.snap = snap(1);
    const el = render(true);
    expect(el.querySelector("[data-slot-name=presence] [data-testid=presence-bar]")).not.toBeNull();
    expect((h.presenceProps as { pageId: string }).pageId).toBe("doc:p1");
  });
});

describe("SlidesEditorImpl comments", () => {
  const button = () => container.querySelector("[data-slot-name=actions] button[aria-pressed]") as HTMLButtonElement | null;

  it("offers no Comments button to someone who cannot comment", () => {
    h.snap = snap(1);
    render(true);
    expect(button()).toBeNull();
    expect(container.querySelector("[data-testid=comments-panel]")).toBeNull();
  });

  it("puts a Comments button in the page bar's actions that toggles the panel", () => {
    h.snap = snap(1);
    render(true, { canComment: true });
    expect(button()!.textContent).toContain("Comments");
    expect(container.querySelector("[data-testid=comments-panel]")).toBeNull();
    act(() => button()!.click());
    expect(container.querySelector("[data-testid=comments-panel]")).not.toBeNull();
    act(() => button()!.click());
    expect(container.querySelector("[data-testid=comments-panel]")).toBeNull();
  });

  it("gives a viewer who can comment the button and panel beside the read-only deck", () => {
    h.snap = snap(1);
    render(false, { canComment: true });
    act(() => button()!.click());
    expect(container.querySelector("[data-testid=read-only]")).not.toBeNull();
    expect(container.querySelector("[data-testid=comments-panel]")).not.toBeNull();
  });

  it("opens the slide and thread a comment link names", () => {
    h.snap = snap(1);
    render(false, { canComment: true, link: { slideId: "b", threadId: "t9" } });
    expect(container.querySelector("[data-testid=read-only]")!.getAttribute("data-current")).toBe("b");
    expect(container.querySelector("[data-testid=comments-panel]")!.getAttribute("data-focus")).toBe("t9");
  });

  it("falls back to the first slide when the linked slide no longer exists", () => {
    h.snap = snap(1);
    render(false, { canComment: true, link: { slideId: "nope", threadId: null } });
    expect(container.querySelector("[data-testid=read-only]")!.getAttribute("data-current")).toBe("a");
  });
});
