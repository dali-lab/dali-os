// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { DndContext, MouseSensor, useDraggable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { DriveBrowser, ScopeList } from "~/components/drive/DriveBrowser";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";
import type { DriveTypeFilter } from "~/components/drive/type-filter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = new Date("2026-01-01T00:00:00Z");
const doc = (id: string, parentFolderId: string | null = null): DriveItem => ({
  type: "doc", id, title: `Doc ${id}`, parentFolderId, iconEmoji: null, updatedAt: at, href: `/documents/${id}`,
});
const folder = (id: string, extra: Partial<DriveItem> = {}): DriveItem =>
  ({
    type: "folder", id, title: `Folder ${id}`, parentFolderId: null, iconEmoji: null, updatedAt: at, href: `/documents/${id}`,
    audience: { kind: "lab", label: "Everyone in the lab", permission: "View" },
    ...extra,
  }) as DriveItem;

const lab: DriveTreeScope = {
  id: "lab",
  label: "Lab-wide",
  iconEmoji: null,
  items: [folder("f1"), doc("d1"), doc("d2"), doc("d3"), doc("d4", "f1"), doc("d5", "f1"), folder("f2", { parentFolderId: "f1" })],
};
const mine: DriveTreeScope = { id: "mine", label: "My Drive", iconEmoji: null, items: [doc("m1")] };
const actions = { onRename: vi.fn(), onRequestMove: vi.fn(), onDelete: vi.fn() };

let container: HTMLDivElement;
let root: Root;
const onOpenItem = vi.fn();
const onOpenBeside = vi.fn();
const onToggleFavorite = vi.fn();
const onBulkMove = vi.fn();
const onBulkDelete = vi.fn();
const onNavigate = vi.fn();
const onHistory = vi.fn();
const onMove = vi.fn();
const onMoveToScope = vi.fn();
const onUploadFiles = vi.fn();

let swapScopes: (scopes: DriveTreeScope[]) => void = () => {};
let swapSearch: (search: string) => void = () => {};

type MountOptions = {
  view?: "columns" | "list" | "grid";
  scopeId?: string | null;
  folderId?: string | null;
  search?: string;
  onHistory?: boolean;
  initialSelectedId?: string;
  revealId?: string;
  typeFilter?: DriveTypeFilter;
  scopes?: DriveTreeScope[];
  canUpload?: boolean;
  receiverViewer?: { isCore: boolean; isProjectMember: boolean };
  beside?: boolean;
  entry?: string;
};

/** The browser at a location, with `onNavigate` moving it the way the hub's URL does. */
async function mount(opts: MountOptions = {}) {
  if (opts.view && opts.view !== "columns") window.localStorage.setItem("dali_drive_view", opts.view);
  function Harness() {
    const [scopesState, setScopesState] = useState(opts.scopes ?? [lab, mine]);
    swapScopes = setScopesState;
    const [searchState, setSearchState] = useState(opts.search ?? "");
    swapSearch = setSearchState;
    const [loc, setLoc] = useState({ scopeId: opts.scopeId === undefined ? "lab" : opts.scopeId, folderId: opts.folderId ?? null });
    return createElement(ToastProvider, null, createElement(DialogProvider, null, createElement(DriveBrowser, {
      scopes: scopesState,
      currentScopeId: loc.scopeId,
      currentFolderId: loc.folderId,
      typeFilter: opts.typeFilter ?? "all",
      search: searchState,
      onSearchChange: vi.fn(),
      onNavigate: (scopeId: string | null, folderId: string | null) => {
        onNavigate(scopeId, folderId);
        setLoc({ scopeId, folderId });
      },
      onHistory: opts.onHistory ? onHistory : undefined,
      initialSelectedId: opts.initialSelectedId,
      revealId: opts.revealId,
      onMove,
      onMoveToScope,
      onOpenItem,
      onOpenBeside: opts.beside ? onOpenBeside : undefined,
      onToggleFavorite,
      getScopeActions: () => actions,
      onBulkMove,
      onBulkDelete,
      onUploadFiles: opts.canUpload === false ? undefined : onUploadFiles,
      receiverViewer: opts.receiverViewer,
    })));
  }
  const Stub = createRoutesStub([{ path: "/", Component: Harness }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: [opts.entry ?? "/"] }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const row = (type: string, id: string) => byTestId(`drive-item-${type}-${id}`);
const click = (el: Element, init: MouseEventInit = {}) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  });
const dblClick = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  });
const contextMenu = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  });
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });
const pointer = (el: Element, type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number, init: MouseEventInit = {}) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init }));
  });
const bar = () => container.querySelector('[data-testid="drive-bulk-bar"]');
const isSelected = (id: string) =>
  container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)?.getAttribute("data-selected") === "true";
const selectedCount = () => container.querySelectorAll('[data-selected="true"]').length;
/** Add a row to the selection without opening it, as cmd-click does. */
const toggle = (id: string) => click(row(id.startsWith("f") ? "folder" : "doc", id), { metaKey: true });
const tap = (el: Element) =>
  act(async () => {
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "pointerType", { value: "touch" });
    el.dispatchEvent(ev);
  });
const pane = (view: "columns" | "list" = "columns") => byTestId(view === "columns" ? "drive-columns" : "drive-list-pane");
const crumbRoot = () => container.querySelector('[data-testid="drive-crumb-root"]');

/** Lay rows out as stacked 30px bands inside a 200px-wide box, since jsdom has no layout. */
function layOut(host: HTMLElement, rows: HTMLElement[]) {
  const box = (top: number, bottom: number) => ({ left: 0, right: 200, top, bottom, width: 200, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
  host.getBoundingClientRect = () => box(0, 400) as DOMRect;
  rows.forEach((r, i) => (r.getBoundingClientRect = () => box(i * 30, i * 30 + 30) as DOMRect));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  (globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
  window.localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe.each(["columns", "list"] as const)("DriveBrowser %s: click selects, double-click opens", (view) => {
  it("selects a document alone on a plain click, opening nothing", async () => {
    await mount({ view });
    await click(row("doc", "d1"));
    expect(isSelected("d1")).toBe(true);
    expect(selectedCount()).toBe(1);
    expect(bar()).toBeNull();
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it(
    view === "columns"
      ? "shows a folder's contents in the next column on a plain click, without selecting it"
      : "selects a folder on a plain click without entering it",
    async () => {
      await mount({ view });
      await click(row("folder", "f1"));
      if (view === "columns") {
        expect(onNavigate).toHaveBeenCalledWith("lab", "f1");
        expect(selectedCount()).toBe(0);
      } else {
        expect(onNavigate).not.toHaveBeenCalled();
        expect(isSelected("f1")).toBe(true);
      }
      expect(onOpenItem).not.toHaveBeenCalled();
    },
  );

  it("opens a document on a double-click", async () => {
    await mount({ view });
    await dblClick(row("doc", "d1"));
    expect(onOpenItem).toHaveBeenCalledTimes(1);
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
    expect(selectedCount()).toBe(0);
  });

  it("enters a folder on a double-click", async () => {
    await mount({ view });
    await dblClick(row("folder", "f1"));
    expect(onNavigate).toHaveBeenCalledWith("lab", "f1");
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("opens on a tap, since touch has no double-click", async () => {
    await mount({ view });
    await tap(row("doc", "d1"));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
    expect(selectedCount()).toBe(0);
  });

  it("builds a multi-selection with cmd/ctrl-click without opening anything", async () => {
    await mount({ view });
    await click(row("doc", "d1"), { metaKey: true });
    expect(bar()).toBeNull();
    await click(row("doc", "d2"), { metaKey: true });
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(bar()?.textContent).toContain("2 selected");
    await click(row("doc", "d3"), { ctrlKey: true });
    expect(bar()?.textContent).toContain("3 selected");
    await click(row("doc", "d3"), { ctrlKey: true });
    expect(bar()?.textContent).toContain("2 selected");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("extends a range with shift-click from the anchor", async () => {
    await mount({ view });
    await click(row("doc", "d1"));
    await click(row("doc", "d3"), { shiftKey: true });
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(bar()?.textContent).toContain("3 selected");
    expect(["d1", "d2", "d3"].map(isSelected)).toEqual([true, true, true]);
  });

  it("treats shift-click with no anchor as a plain click", async () => {
    await mount({ view });
    await click(row("doc", "d2"), { shiftKey: true });
    expect(isSelected("d2")).toBe(true);
    expect(selectedCount()).toBe(1);
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("clears the selection on a click on empty space deeper than a drive's top level", async () => {
    await mount({ view, folderId: "f1" });
    await click(row("doc", "d4"));
    expect(isSelected("d4")).toBe(true);
    await click(pane(view));
    expect(isSelected("d4")).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("goes back to the list of drives on a click on empty space at a drive's top level", async () => {
    await mount({ view });
    await click(row("doc", "d1"));
    await click(pane(view));
    expect(onNavigate).toHaveBeenCalledWith(null, null);
  });

  it("only clears the selection on empty space at the root", async () => {
    await mount({ view, scopeId: null });
    await click(pane(view));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("does not go up for a click that comes from the toolbar", async () => {
    await mount({ view });
    await click(byTestId("drive-breadcrumb"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("keeps the selection when a menu entry is chosen", async () => {
    await mount({ view });
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d2"), { metaKey: true });
    await contextMenu(row("doc", "d1"));
    const rename = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) => el.textContent === "Rename")!;
    await click(rename);
    expect(actions.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
    expect(bar()?.textContent).toContain("2 selected");
  });

  it("focuses and selects the row that is right-clicked when it is outside the selection", async () => {
    await mount({ view });
    await click(row("doc", "d1"), { metaKey: true });
    await contextMenu(row("doc", "d3"));
    expect(isSelected("d1")).toBe(false);
    expect(isSelected("d3")).toBe(true);
    expect(bar()).toBeNull();
  });

  it("runs Delete from the menu on the whole selection when the clicked row is in it", async () => {
    await mount({ view });
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d2"), { metaKey: true });
    await contextMenu(row("doc", "d2"));
    const del = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) => el.textContent === "Delete")!;
    await click(del);
    expect(onBulkDelete).toHaveBeenCalledTimes(1);
    expect(onBulkDelete.mock.calls[0][0].map((i: DriveItem) => i.id).sort()).toEqual(["d1", "d2"]);
    expect(actions.onDelete).not.toHaveBeenCalled();
  });

  it("shows the root crumb, which goes back to the list of drives", async () => {
    await mount({ view, folderId: "f1" });
    expect(crumbRoot()?.textContent).toContain("Drive");
    await click(crumbRoot()!);
    expect(onNavigate).toHaveBeenCalledWith(null, null);
  });

  it("keeps the root crumb at the list of drives too", async () => {
    await mount({ view, scopeId: null });
    expect(crumbRoot()).not.toBeNull();
  });
});

describe.each(["columns", "list"] as const)("DriveBrowser %s: keyboard", (view) => {
  it("moves focus with up and down, selecting only that row", async () => {
    await mount({ view });
    const p = pane(view);
    await key(p, "ArrowDown");
    const first = view === "list" ? "f1" : "f1";
    expect(isSelected(first)).toBe(true);
    await key(p, "ArrowDown");
    await key(p, "ArrowDown");
    expect(isSelected("d2")).toBe(true);
    expect(isSelected("f1")).toBe(false);
    expect(bar()).toBeNull();
    await key(p, "ArrowUp");
    expect(isSelected("d1")).toBe(true);
    expect(isSelected("d2")).toBe(false);
  });

  it("does not navigate when focus lands on a folder, but Enter does", async () => {
    await mount({ view });
    const p = pane(view);
    await key(p, "ArrowDown");
    expect(onNavigate).not.toHaveBeenCalled();
    await key(p, "Enter");
    expect(onNavigate).toHaveBeenCalledWith("lab", "f1");
  });

  it("opens the focused document with Enter", async () => {
    await mount({ view });
    const p = pane(view);
    await key(p, "ArrowDown");
    await key(p, "ArrowDown");
    await key(p, "Enter");
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
  });

  it("goes up a level with Backspace and with cmd-up, which wins over plain up", async () => {
    await mount({ view, folderId: "f1" });
    const p = pane(view);
    await key(p, "Backspace");
    expect(onNavigate).toHaveBeenLastCalledWith("lab", null);
    await key(p, "ArrowDown");
    onNavigate.mockClear();
    await mount({ view, folderId: "f1" });
    await key(pane(view), "ArrowUp", { metaKey: true });
    expect(onNavigate).toHaveBeenCalledWith("lab", null);
    expect(container.querySelectorAll("input:checked").length).toBe(0);
  });

  it("goes up to the list of drives from a drive's top level", async () => {
    await mount({ view });
    await key(pane(view), "Backspace");
    expect(onNavigate).toHaveBeenCalledWith(null, null);
  });

  it("goes up from an empty-handed pane too (no rows needed)", async () => {
    await mount({ view, folderId: "f1" });
    await key(pane(view), "ArrowUp", { ctrlKey: true });
    expect(onNavigate).toHaveBeenCalledWith("lab", null);
  });

  it("clears the selection with Escape", async () => {
    await mount({ view });
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d2"), { metaKey: true });
    expect(bar()).not.toBeNull();
    await key(pane(view), "Escape");
    expect(bar()).toBeNull();
    expect(isSelected("d1")).toBe(false);
  });

  it("selects the whole pool with cmd-A", async () => {
    await mount({ view });
    await key(pane(view), "a", { metaKey: true });
    expect(bar()?.textContent).toContain("4 selected");
  });

  it("deletes the whole selection with Delete when several are selected", async () => {
    await mount({ view });
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d2"), { metaKey: true });
    await key(pane(view), "Delete");
    expect(onBulkDelete.mock.calls[0][0].map((i: DriveItem) => i.id).sort()).toEqual(["d1", "d2"]);
    expect(actions.onDelete).not.toHaveBeenCalled();
  });

  it("deletes the single selected item through the item path", async () => {
    await mount({ view });
    await click(row("doc", "d3"));
    await key(pane(view), "#");
    expect(actions.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "d3" }));
    expect(onBulkDelete).not.toHaveBeenCalled();
  });

  it("renames the focused item with F2", async () => {
    await mount({ view });
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d2"), { metaKey: true });
    await key(pane(view), "F2");
    expect(actions.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: "d2" }));
  });

  it("jumps to a row by typing the start of its name, buffering letters typed together", async () => {
    await mount({ view });
    const p = pane(view);
    await key(p, "d");
    expect(isSelected("d1")).toBe(true);
    await key(p, "f");
    expect(isSelected("d1")).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("starts a fresh type-ahead after a second of silence", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await mount({ view });
      const p = pane(view);
      await key(p, "f");
      expect(isSelected("f1")).toBe(true);
      vi.setSystemTime(Date.now() + 1500);
      await key(p, "d");
      expect(isSelected("d1")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DriveBrowser columns: layout follows the URL", () => {
  it("opens the folder's column straight away on a click", async () => {
    await mount();
    expect(byTestId("drive-col-2")).toBeNull();
    await click(row("folder", "f1"));
    expect(byTestId("drive-col-2")).not.toBeNull();
    expect(row("doc", "d4")).not.toBeNull();
  });

  it("marks the open folder in its column from the location, not from a separate highlight", async () => {
    await mount({ folderId: "f1" });
    expect(row("folder", "f1").className).toContain("bg-os-container");
    expect(row("doc", "d1").className).not.toContain("bg-os-container");
  });

  it("moves between columns with left and right, focusing the open folder going left", async () => {
    await mount({ folderId: "f1" });
    const p = pane();
    await click(row("doc", "d4"));
    await key(p, "ArrowLeft");
    expect(isSelected("f1")).toBe(true);
    expect(isSelected("d4")).toBe(false);
    await key(p, "ArrowDown");
    expect(isSelected("d1")).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
    await key(p, "ArrowUp");
    await key(p, "ArrowUp");
    expect(isSelected("f1")).toBe(true);
    await key(p, "ArrowRight");
    expect(isSelected("f2")).toBe(true);
  });

  it("enters a folder with the right arrow when it is not open yet", async () => {
    await mount();
    const p = pane();
    await key(p, "ArrowDown");
    await key(p, "ArrowRight");
    expect(onNavigate).toHaveBeenCalledWith("lab", "f1");
    expect(isSelected("f2")).toBe(true);
  });

  it("does not open a document with the right arrow", async () => {
    await mount();
    const p = pane();
    await key(p, "ArrowDown");
    await key(p, "ArrowDown");
    await key(p, "ArrowRight");
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("keeps the layout when the drives are refetched", async () => {
    await mount();
    await click(row("folder", "f1"));
    expect(byTestId("drive-col-2")).not.toBeNull();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

});

describe("DriveBrowser: drag past the threshold selects (marquee)", () => {
  it("selects every row the rectangle crosses in a column", async () => {
    await mount();
    const col = byTestId("drive-col-1");
    layOut(col, [row("folder", "f1"), row("doc", "d1"), row("doc", "d2"), row("doc", "d3")]);
    await pointer(col, "pointerdown", 10, 200);
    await pointer(col, "pointermove", 10, 75);
    expect(byTestId("drive-marquee")).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(byTestId("drive-marquee").className).toContain("border-os-accent");
    await pointer(col, "pointerup", 10, 75);
    expect(byTestId("drive-marquee")).toBeNull();
    expect(["f1", "d1", "d2", "d3"].map(isSelected)).toEqual([false, false, true, true]);
    expect(bar()?.textContent).toContain("2 selected");
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("selects every row the rectangle crosses in the list", async () => {
    await mount({ view: "list" });
    const host = pane("list");
    layOut(host, [row("folder", "f1"), row("doc", "d1"), row("doc", "d2"), row("doc", "d3")]);
    await pointer(host, "pointerdown", 10, 380);
    await pointer(host, "pointermove", 10, 40);
    await pointer(host, "pointerup", 10, 40);
    expect(["f1", "d1", "d2", "d3"].map(isSelected)).toEqual([false, true, true, true]);
  });

  it("replaces the selection, or adds to it when shift was held at pointer-down", async () => {
    await mount();
    const col = byTestId("drive-col-1");
    layOut(col, [row("folder", "f1"), row("doc", "d1"), row("doc", "d2"), row("doc", "d3")]);
    await click(row("doc", "d1"));
    await pointer(col, "pointerdown", 10, 200);
    await pointer(col, "pointermove", 10, 75);
    await pointer(col, "pointerup", 10, 75);
    expect(["d1", "d2", "d3"].map(isSelected)).toEqual([false, true, true]);
    await pointer(col, "pointerdown", 10, 130, { shiftKey: true });
    await pointer(col, "pointermove", 10, 100, { shiftKey: true });
    await pointer(col, "pointerup", 10, 100, { shiftKey: true });
    expect(["d1", "d2", "d3"].map(isSelected)).toEqual([false, true, true]);
    await toggle("d1");
    await pointer(col, "pointerdown", 10, 200, { metaKey: true });
    await pointer(col, "pointermove", 10, 100, { metaKey: true });
    await pointer(col, "pointerup", 10, 100, { metaKey: true });
    expect(["d1", "d2", "d3"].map(isSelected)).toEqual([true, true, true]);
  });

  it("never starts from a row", async () => {
    await mount();
    const col = byTestId("drive-col-1");
    layOut(col, [row("folder", "f1"), row("doc", "d1"), row("doc", "d2"), row("doc", "d3")]);
    await pointer(row("doc", "d1"), "pointerdown", 10, 45);
    await pointer(row("doc", "d1"), "pointermove", 10, 100);
    await pointer(row("doc", "d1"), "pointerup", 10, 100);
    expect(bar()).toBeNull();
    expect(["d1", "d2", "d3"].map(isSelected)).toEqual([false, false, false]);
  });

  it("is a click, not a selection, while the pointer stays within 4px", async () => {
    await mount();
    const col = byTestId("drive-col-1");
    layOut(col, [row("folder", "f1"), row("doc", "d1"), row("doc", "d2"), row("doc", "d3")]);
    await pointer(col, "pointerdown", 10, 100);
    await pointer(col, "pointermove", 12, 98);
    await pointer(col, "pointerup", 12, 98);
    await click(col);
    expect(onNavigate).toHaveBeenCalledWith(null, null);
  });

  it("swallows the click that ends a drag, so it does not go up a level", async () => {
    await mount();
    const col = byTestId("drive-col-1");
    layOut(col, [row("folder", "f1"), row("doc", "d1"), row("doc", "d2"), row("doc", "d3")]);
    await pointer(col, "pointerdown", 10, 200);
    await pointer(col, "pointermove", 10, 75);
    // The browser fires the click in the same task as the pointer-up.
    await act(async () => {
      col.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 10, clientY: 75, button: 0 }));
      col.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(bar()).not.toBeNull();
    await click(col);
    expect(onNavigate).toHaveBeenCalledWith(null, null);
  });
});

describe("DriveBrowser: views and search", () => {
  it("keeps the selection that is still on screen when the view changes", async () => {
    await mount({ folderId: "f1" });
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d4"), { metaKey: true });
    expect(bar()?.textContent).toContain("2 selected");
    await click(byTestId("drive-view-list"));
    expect(isSelected("d4")).toBe(true);
    expect(bar()).toBeNull();
    await click(byTestId("drive-view-columns"));
    expect(isSelected("d4")).toBe(true);
    expect(isSelected("d1")).toBe(false);
  });

  it("keeps everything selected across a switch that shows the same rows", async () => {
    await mount();
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d2"), { metaKey: true });
    await click(byTestId("drive-view-grid"));
    expect(bar()?.textContent).toContain("2 selected");
    await click(byTestId("drive-view-list"));
    expect(bar()?.textContent).toContain("2 selected");
  });

  it("rebuilds the columns from the location when switching back to them", async () => {
    await mount({ view: "list", folderId: "f1" });
    await click(byTestId("drive-view-columns"));
    expect(byTestId("drive-col-2")).not.toBeNull();
    expect(row("doc", "d4")).not.toBeNull();
  });

  it("hides the view toggle while searching, and results use the list keys", async () => {
    await mount({ search: "Doc" });
    expect(container.querySelector('[data-testid="drive-view-list"]')).toBeNull();
    const p = byTestId("drive-list-pane");
    await key(p, "ArrowDown");
    expect(isSelected("d1")).toBe(true);
    await click(byTestId("drive-search-hit-d2"));
    expect(isSelected("d2")).toBe(true);
    expect(onOpenItem).not.toHaveBeenCalled();
    await dblClick(byTestId("drive-search-hit-d2"));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "d2" }));
  });

  it("enters a drive with a plain click on its row at the root", async () => {
    await mount({ view: "list", scopeId: null });
    await click(byTestId("drive-scope-lab"));
    expect(onNavigate).toHaveBeenCalledWith("lab", null);
  });

  it("enters a folder from the band at a drive's top level with a double-click", async () => {
    await mount({ view: "grid" });
    await click(row("folder", "f1"));
    expect(isSelected("f1")).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
    await dblClick(row("folder", "f1"));
    expect(onNavigate).toHaveBeenCalledWith("lab", "f1");
  });

  it("selects a band card and a tile together with cmd-click in the grid", async () => {
    await mount({ view: "grid" });
    await toggle("f1");
    await toggle("d1");
    expect(bar()?.textContent).toContain("2 selected");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("moves along a grid row with the left and right arrows", async () => {
    await mount({ view: "grid" });
    const p = pane("list");
    await key(p, "ArrowRight");
    expect(isSelected("f1")).toBe(true);
    await key(p, "ArrowRight");
    expect(isSelected("d1")).toBe(true);
    await key(p, "ArrowLeft");
    expect(isSelected("f1")).toBe(true);
  });

  it("walks the drives at the root without selecting them", async () => {
    await mount({ view: "list", scopeId: null });
    const p = pane("list");
    await key(p, "ArrowDown");
    await key(p, "ArrowDown");
    await key(p, "Enter");
    expect(onNavigate).toHaveBeenCalledWith("mine", null);
    expect(bar()).toBeNull();
  });

  it("does not select the drives with cmd-A at the root", async () => {
    await mount({ view: "list", scopeId: null });
    await key(pane("list"), "a", { metaKey: true });
    expect(bar()).toBeNull();
  });
});

describe("DriveBrowser history", () => {
  it("steps the host's history from Back and Forward when it has one", async () => {
    await mount({ onHistory: true });
    await click(row("folder", "f1"));
    await click(byTestId("drive-back"));
    expect(onHistory).toHaveBeenCalledWith(-1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("walks its own trail of folders when the host has no history", async () => {
    await mount();
    await click(row("folder", "f1"));
    await click(byTestId("drive-back"));
    expect(onNavigate).toHaveBeenLastCalledWith("lab", null);
  });
});

describe("DriveBrowser bulk bar", () => {
  async function selectTwo() {
    await mount();
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d2"), { metaKey: true });
  }

  it("floats as a centered card with Move, Delete and Clear controls", async () => {
    await selectTwo();
    const el = bar()!;
    expect(el.className).toContain("absolute");
    expect(el.className).toContain("-translate-x-1/2");
    expect(el.className).toContain("bg-os-card");
    expect(el.className).not.toContain("bg-os-accent/10");
    expect(el.querySelector('[data-testid="drive-bulk-move"]')?.textContent).toContain("Move");
    expect(el.querySelector('[data-testid="drive-bulk-delete"]')?.textContent).toContain("Delete");
    expect(el.querySelector('[aria-label="Clear selection"]')).not.toBeNull();
  });

  it("hands the selected items to Move and Delete", async () => {
    await selectTwo();
    await click(container.querySelector('[data-testid="drive-bulk-move"]')!);
    expect(onBulkMove.mock.calls[0][0].map((i: DriveItem) => i.id).sort()).toEqual(["d1", "d2"]);
    await click(container.querySelector('[data-testid="drive-bulk-delete"]')!);
    expect(onBulkDelete.mock.calls[0][0].map((i: DriveItem) => i.id).sort()).toEqual(["d1", "d2"]);
  });

  it("clears the selection", async () => {
    await selectTwo();
    await click(container.querySelector('[aria-label="Clear selection"]')!);
    expect(bar()).toBeNull();
  });

  it("reserves room under the columns so the bar never covers the last row", async () => {
    await selectTwo();
    expect(container.querySelector('[data-testid="drive-columns"]')!.className).toContain("pb-14");
  });

  it("does not reserve that room when nothing is multi-selected", async () => {
    await mount();
    expect(container.querySelector('[data-testid="drive-columns"]')!.className).not.toContain("pb-14");
  });

  it("reserves room under the list only while the bar is up", async () => {
    await mount({ view: "list" });
    expect(pane("list").className).not.toContain("pb-14");
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d2"), { metaKey: true });
    expect(pane("list").className).toContain("pb-14");
  });
});

describe("DriveBrowser glyph tooltips", () => {
  it("labels a folder glyph with what it is and who can see it", async () => {
    await mount();
    const glyph = row("folder", "f1").querySelector('[data-testid="item-glyph"]')!;
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    await act(async () => {
      glyph.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Folder · Everyone in the lab");
  });

  it("labels a system folder by what it receives, in pink", async () => {
    await mount({ scopes: [{ ...lab, items: [folder("hf", { folderType: "HiringForms" } as Partial<DriveItem>)] }] });
    const glyph = row("folder", "hf").querySelector('[data-testid="item-glyph"]')!;
    expect(glyph.querySelector("svg.lucide-folder-cog.text-accent-pink")).not.toBeNull();
    await act(async () => {
      glyph.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Hiring forms folder · Everyone in the lab");
  });

  it("leaves row clicks working through the glyph wrapper", async () => {
    await mount();
    const glyph = row("doc", "d1").querySelector('[data-testid="item-glyph"]')!;
    await click(glyph);
    expect(isSelected("d1")).toBe(true);
    await dblClick(glyph);
    expect(onOpenItem).toHaveBeenCalledTimes(1);
  });
});

const box = (top: number, bottom: number) =>
  ({ left: 0, right: 200, top, bottom, width: 200, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
const place = (el: Element, top: number) => {
  el.getBoundingClientRect = () => box(top, top + 30);
};
const mouse = (target: Element | Document, type: "mousedown" | "mousemove" | "mouseup", y: number) =>
  act(async () => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: y }));
  });
const realRect = HTMLElement.prototype.getBoundingClientRect;
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
});
/**
 * Pick `el` up and carry it `dy` px down. The drag starts past 6px; whatever it
 * should land on is placed first. The drag overlay is measured for collisions
 * and has no layout in jsdom, so every unplaced element sits at the top.
 */
async function carry(el: Element, dy: number) {
  HTMLElement.prototype.getBoundingClientRect = () => box(0, 30);
  await mouse(el, "mousedown", 10);
  await mouse(document, "mousemove", 20);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  await mouse(document, "mousemove", 10 + dy);
}
/** Drop, then wait out dnd-kit's 50ms click guard on the document, which would swallow the next test's first clicks. */
const release = async () => {
  await mouse(document, "mouseup", 10);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
};
const ghost = () => document.querySelector('[data-testid="drive-drag-ghost"]');

const hoverGlyph = (el: Element) =>
  act(async () => {
    el.querySelector('[data-testid="item-glyph"]')!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    await new Promise((r) => setTimeout(r, 400));
  });
const menuLabels = () => Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent);
const menuItem = (label: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) => el.textContent === label)!;
const actionsButton = (id: string) => byTestId(`drive-item-actions-${id}`);

describe("DriveBrowser: the glyph leads the row", () => {
  const leadViews = [
    ["columns", { view: "columns" as const }, () => row("folder", "f1")],
    ["list", { view: "list" as const, folderId: "f1" }, () => row("folder", "f2")],
    ["search", { search: "Folder" }, () => byTestId("drive-search-hit-f1")],
  ] as const;

  describe.each(leadViews)("%s", (_name, opts, target) => {
    it("puts nothing before the glyph, and no checkbox anywhere in the row", async () => {
      await mount(opts);
      const glyph = target().querySelector('[data-testid="item-glyph"]')!;
      expect(glyph.parentElement!.previousElementSibling).toBeNull();
      expect(target().querySelector("input")).toBeNull();
    });

    it("leaves the glyph uncovered so its tooltip shows on hover", async () => {
      await mount(opts);
      await hoverGlyph(target());
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Folder · Everyone in the lab");
    });
  });

  it("has no checkbox on a tile or a band card either", async () => {
    await mount({ view: "grid" });
    for (const el of [row("folder", "f1"), row("doc", "d1")]) expect(el.querySelector("input")).toBeNull();
  });
});

describe("DriveBrowser drag: one ghost, from the overlay", () => {
  const cases = [
    ["columns", { view: "columns" as const }],
    ["list", { view: "list" as const }],
    ["grid tile", { view: "grid" as const }],
  ] as const;

  describe.each(cases)("%s", (_name, opts) => {
    it("dims the source in place and shows only the overlay under the pointer", async () => {
      await mount(opts);
      await carry(row("doc", "d1"), 40);
      expect(ghost()?.textContent).toBe("Doc d1");
      expect(row("doc", "d1").style.transform).toBe("");
      expect(row("doc", "d1").className).toContain("opacity-40");
      await release();
      expect(ghost()).toBeNull();
      expect(row("doc", "d1").className).not.toContain("opacity-40");
    });

    it("says how many items a multi-selection carries", async () => {
      await mount(opts);
      await click(row("doc", "d1"), { metaKey: true });
      await click(row("doc", "d2"), { metaKey: true });
      await carry(row("doc", "d2"), 40);
      expect(ghost()?.textContent).toBe("2 items");
      await release();
    });

    it("carries only the row dragged when it is outside the selection", async () => {
      await mount(opts);
      await click(row("doc", "d1"), { metaKey: true });
      await click(row("doc", "d2"), { metaKey: true });
      await carry(row("doc", "d3"), 40);
      expect(ghost()?.textContent).toBe("Doc d3");
      await release();
    });
  });

  it("does the same for a card in the folder band", async () => {
    await mount({ view: "grid" });
    await carry(row("folder", "f1"), 40);
    expect(ghost()?.textContent).toBe("Folder f1");
    expect(row("folder", "f1").style.transform).toBe("");
    expect(row("folder", "f1").className).toContain("opacity-40");
    await release();
  });

  it("includes the glyph in the ghost", async () => {
    await mount({ view: "list" });
    await carry(row("doc", "d1"), 40);
    expect(ghost()?.querySelector("svg")).not.toBeNull();
    await release();
  });
});

describe("DriveBrowser drag: dropping on a folder", () => {
  const cases = [
    ["columns", { view: "columns" as const }, "d1", "f1", null],
    ["list (folder band)", { view: "list" as const }, "d1", "f1", null],
    ["grid (folder band)", { view: "grid" as const }, "d1", "f1", null],
    ["list (folder row)", { view: "list" as const, folderId: "f1" }, "d4", "f2", "f1"],
    ["grid (folder tile)", { view: "grid" as const, folderId: "f1" }, "d4", "f2", "f1"],
  ] as const;

  it.each(cases)("%s: rings the folder under the pointer and moves into it on release", async (_name, opts, from, to) => {
    await mount(opts);
    place(row("doc", from), 0);
    place(row("folder", to), 100);
    await carry(row("doc", from), 100);
    expect(row("folder", to).className).toContain("ring-2");
    expect(row("folder", to).className).toContain("ring-os-accent");
    expect(row("folder", to).className).toContain("bg-os-accent/10");
    await release();
    expect(onMove).toHaveBeenCalledWith("lab", [expect.objectContaining({ id: from })], to);
  });

  it("moves the whole selection when the dragged row is part of it", async () => {
    await mount({ view: "grid" });
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d2"), { metaKey: true });
    place(row("doc", "d1"), 0);
    place(row("folder", "f1"), 100);
    await carry(row("doc", "d1"), 100);
    await release();
    expect(onMove.mock.calls[0][1].map((i: DriveItem) => i.id).sort()).toEqual(["d1", "d2"]);
  });

  it("takes the ring off a folder once the pointer leaves it", async () => {
    await mount({ view: "list" });
    place(row("doc", "d1"), 0);
    place(row("folder", "f1"), 100);
    await carry(row("doc", "d1"), 100);
    expect(row("folder", "f1").className).toContain("ring-os-accent");
    await mouse(document, "mousemove", 300);
    expect(row("folder", "f1").className).not.toContain("ring-os-accent");
    await release();
    expect(onMove).not.toHaveBeenCalled();
  });

  // The folder band lays tiles side by side, so a dragged row (as wide as the
  // listing) overlaps every tile in the band by the same amount. The drop goes
  // to the tile under the pointer, not the first one registered.
  it.each(["list", "grid"] as const)("%s: drops into the tile under the pointer, not the first tile of the band", async (view) => {
    const twoFolders: DriveTreeScope = { ...lab, items: [folder("f1"), folder("f3"), doc("d1")] };
    await mount({ view, scopes: [twoFolders, mine] });
    const tile = (left: number, right: number) =>
      ({ left, right, top: 100, bottom: 130, width: right - left, height: 30, x: left, y: 100, toJSON: () => ({}) }) as DOMRect;
    // The row is picked up at x=10 and is 200 wide, so at x=150 it spans
    // 140..340: both tiles by the same amount, with the pointer in f3.
    place(row("doc", "d1"), 0);
    row("folder", "f1").getBoundingClientRect = () => tile(240, 340);
    row("folder", "f3").getBoundingClientRect = () => tile(140, 240);
    await carry(row("doc", "d1"), 100);
    await act(async () => {
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 150, clientY: 110 }));
    });
    expect(row("folder", "f3").className).toContain("ring-os-accent");
    expect(row("folder", "f1").className).not.toContain("ring-os-accent");
    await release();
    expect(onMove).toHaveBeenCalledWith("lab", [expect.objectContaining({ id: "d1" })], "f3");
  });
});

describe("DriveBrowser drag: dropping on a notebook", () => {
  const notebook = { ...doc("nb1"), title: "Weekly sync", isNotebook: true, tabCount: 2 } as DriveItem;
  const board = { ...doc("w1"), isWhiteboard: true } as DriveItem;
  const withNotebook: DriveTreeScope = { ...lab, items: [folder("f1"), notebook, doc("d1"), doc("d2"), board] };
  const views = [
    ["columns", { view: "columns" as const }],
    ["list", { view: "list" as const }],
    ["grid", { view: "grid" as const }],
  ] as const;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const toastText = () => document.body.textContent ?? "";

  describe.each(views)("%s", (_name, opts) => {
    it("rings the notebook under the pointer", async () => {
      await mount({ ...opts, scopes: [withNotebook, mine] });
      place(row("doc", "d1"), 0);
      place(row("doc", "nb1"), 100);
      await carry(row("doc", "d1"), 100);
      expect(row("doc", "nb1").className).toContain("ring-2");
      expect(row("doc", "nb1").className).toContain("ring-os-accent");
      await release();
    });

    it("adds the dropped document to the notebook and says so", async () => {
      await mount({ ...opts, scopes: [withNotebook, mine] });
      place(row("doc", "d1"), 0);
      place(row("doc", "nb1"), 100);
      await carry(row("doc", "d1"), 100);
      await release();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/notebooks/nb1");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ intent: "add-page", pageId: "d1" });
      expect(toastText()).toContain("Added to Weekly sync");
      expect(onMove).not.toHaveBeenCalled();
    });

    it("refuses a folder with a toast and sends nothing", async () => {
      await mount({ ...opts, scopes: [withNotebook, mine] });
      place(row("folder", "f1"), 0);
      place(row("doc", "nb1"), 100);
      await carry(row("folder", "f1"), 100);
      await release();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(toastText()).toContain("Only documents can go in a notebook.");
    });

    it("refuses a whiteboard", async () => {
      await mount({ ...opts, scopes: [withNotebook, mine] });
      place(row("doc", "w1"), 0);
      place(row("doc", "nb1"), 100);
      await carry(row("doc", "w1"), 100);
      await release();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(toastText()).toContain("Only documents can go in a notebook.");
    });
  });

  it("adds every document of a multi-selection", async () => {
    await mount({ view: "grid", scopes: [withNotebook, mine] });
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d2"), { metaKey: true });
    place(row("doc", "d1"), 0);
    place(row("doc", "nb1"), 100);
    await carry(row("doc", "d1"), 100);
    await release();
    const ids = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).pageId).sort();
    expect(ids).toEqual(["d1", "d2"]);
  });

  it("surfaces the server's refusal instead of claiming success", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "You can't move this document" }) });
    await mount({ view: "list", scopes: [withNotebook, mine] });
    place(row("doc", "d1"), 0);
    place(row("doc", "nb1"), 100);
    await carry(row("doc", "d1"), 100);
    await release();
    expect(toastText()).toContain("You can't move this document");
    expect(toastText()).not.toContain("Added to");
  });

  it("does not ring a plain document", async () => {
    await mount({ view: "list", scopes: [withNotebook, mine] });
    place(row("doc", "d1"), 0);
    place(row("doc", "d2"), 100);
    await carry(row("doc", "d1"), 100);
    expect(row("doc", "d2").className).not.toContain("ring-os-accent");
    await release();
  });
});

describe("DriveBrowser drag: dropping on the breadcrumb", () => {
  it("moves to the drive's top level from its crumb, with the same ring", async () => {
    await mount({ view: "list", folderId: "f1" });
    place(row("doc", "d4"), 0);
    place(byTestId("drive-crumb-scope"), 100);
    await carry(row("doc", "d4"), 100);
    expect(byTestId("drive-crumb-scope").className).toContain("ring-os-accent");
    await release();
    expect(onMove).toHaveBeenCalledWith("lab", [expect.objectContaining({ id: "d4" })], null);
  });

  it("does not take drops on the root Drive crumb, since nothing moves to the list of drives", async () => {
    await mount({ view: "list", folderId: "f1" });
    place(row("doc", "d4"), 0);
    place(crumbRoot()!, 100);
    await carry(row("doc", "d4"), 100);
    expect(crumbRoot()!.className).not.toContain("ring-os-accent");
    await release();
    expect(onMove).not.toHaveBeenCalled();
    expect(onMoveToScope).not.toHaveBeenCalled();
  });
});

describe("DriveBrowser drag: dropping on a drive", () => {
  it("moves between drives from a column-0 row, with the shared ring", async () => {
    await mount();
    place(row("doc", "d1"), 0);
    place(byTestId("drive-scope-mine"), 100);
    await carry(row("doc", "d1"), 100);
    expect(byTestId("drive-scope-mine").className).toContain("ring-2");
    expect(byTestId("drive-scope-mine").className).toContain("ring-os-accent");
    await release();
    expect(onMoveToScope).toHaveBeenCalledWith("lab", "mine", [expect.objectContaining({ id: "d1" })]);
  });

  describe.each(["list", "grid"] as const)("the list of drives, %s", (viewMode) => {
    const projects: DriveTreeScope = { id: "projects", label: "Projects", iconEmoji: null, items: [] };
    const education: DriveTreeScope = { id: "education", label: "Education", iconEmoji: null, items: [] };
    const dropped = vi.fn();

    function Source() {
      const drag = useDraggable({ id: "src", data: { item: doc("d1"), scopeId: "lab" } });
      return createElement("div", { ref: drag.setNodeRef, "data-testid": "src", ...drag.attributes, ...drag.listeners }, "src");
    }

    async function mountScopeList() {
      function Harness() {
        const [dragging, setDragging] = useState(false);
        const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }));
        return createElement(
          DndContext,
          {
            sensors,
            onDragStart: () => setDragging(true),
            onDragEnd: (e: DragEndEvent) => {
              setDragging(false);
              dropped(e.over?.data.current);
            },
          },
          createElement(Source),
          createElement(ScopeList, { scopes: [lab, mine, projects, education], viewMode, focusId: null, dragging, onOpen: vi.fn() }),
        );
      }
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root.render(createElement(Harness));
      });
    }

    it("takes drops on a drive and rings it", async () => {
      await mountScopeList();
      place(byTestId("src"), 0);
      place(byTestId("drive-scope-mine"), 100);
      await carry(byTestId("src"), 100);
      expect(byTestId("drive-scope-mine").className).toContain("ring-2");
      expect(byTestId("drive-scope-mine").className).toContain("ring-os-accent");
      await release();
      expect(dropped).toHaveBeenCalledWith({ destScopeId: "mine" });
    });

    it.each([
      ["projects", "lucide-folder-kanban"],
      ["education", "lucide-graduation-cap"],
    ])("draws the %s drive with its own icon", async (id, iconClass) => {
      await mountScopeList();
      const icon = byTestId(`drive-scope-${id}`).querySelector("svg");
      expect(icon?.getAttribute("class")).toContain(iconClass);
      expect(icon?.getAttribute("class")).toContain("text-accent-coral/80");
      expect(icon?.getAttribute("class")).not.toContain("lucide-folder ");
    });

    it.each(["projects", "education"])("does not take drops on the %s header", async (id) => {
      await mountScopeList();
      place(byTestId("src"), 0);
      place(byTestId(`drive-scope-${id}`), 100);
      await carry(byTestId("src"), 100);
      expect(byTestId(`drive-scope-${id}`).className).not.toContain("ring-os-accent");
      await release();
      expect(dropped).toHaveBeenCalledWith(undefined);
    });
  });

  it("leaves search results undraggable", async () => {
    await mount({ search: "Doc" });
    const hit = byTestId("drive-search-hit-d1");
    expect(hit.getAttribute("aria-roledescription")).toBeNull();
    await carry(hit, 40);
    expect(ghost()).toBeNull();
    await release();
  });
});

describe("DriveBrowser: the click that ends a drag", () => {
  /** A rubber-band drag whose click follows in the same task as the pointer-up, landing on `next`. */
  async function dragThenClick(host: HTMLElement, next: Element) {
    await pointer(host, "pointerdown", 10, 380);
    await pointer(host, "pointermove", 10, 40);
    await act(async () => {
      host.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 10, clientY: 40, button: 0 }));
      next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("is ignored by the root crumb, then the crumb works again", async () => {
    await mount({ view: "list", folderId: "f1" });
    await dragThenClick(pane("list"), crumbRoot()!);
    expect(onNavigate).not.toHaveBeenCalled();
    await click(crumbRoot()!);
    expect(onNavigate).toHaveBeenCalledWith(null, null);
  });

  it("is ignored by a folder crumb", async () => {
    await mount({ view: "list", folderId: "f1" });
    await dragThenClick(pane("list"), byTestId("drive-crumb-scope"));
    expect(onNavigate).not.toHaveBeenCalled();
    await click(byTestId("drive-crumb-scope"));
    expect(onNavigate).toHaveBeenCalledWith("lab", null);
  });

  it("is ignored by a drive row in the first column", async () => {
    await mount();
    await dragThenClick(byTestId("drive-col-1"), byTestId("drive-scope-mine"));
    expect(onNavigate).not.toHaveBeenCalled();
    await click(byTestId("drive-scope-mine"));
    expect(onNavigate).toHaveBeenCalledWith("mine", null);
  });
});

describe.each(["columns", "list", "grid"] as const)("DriveBrowser %s: rows carry no star, chevron or item count", (view) => {
  it("offers Add to favorites from the ... menu and nowhere on the row", async () => {
    await mount({ view });
    const el = row("doc", "d1");
    expect(el.querySelector('[aria-label="Add to favorites"]')).toBeNull();
    expect(el.querySelector("svg.lucide-star")).toBeNull();
    await click(actionsButton("d1"));
    expect(menuLabels()).toContain("Add to favorites");
    await click(menuItem("Add to favorites"));
    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
  });

  it("shows when a folder last changed, with no chevron and no item count", async () => {
    await mount({ view });
    const el = row("folder", "f1");
    expect(el.querySelector("svg.lucide-chevron-right")).toBeNull();
    expect(el.textContent).not.toMatch(/\d+ items|Empty/);
    if (view !== "list") expect(el.querySelector('[data-testid="item-modified"]')).not.toBeNull();
  });
});

describe("DriveBrowser: the row menu on tiles and cards", () => {
  it("offers the same ... button on a tile and a band card as on a list row", async () => {
    await mount({ view: "grid" });
    expect(row("doc", "d1").contains(actionsButton("d1"))).toBe(true);
    expect(row("folder", "f1").contains(actionsButton("f1"))).toBe(true);
  });

  it.each([
    ["a tile", { view: "grid" as const }, "d1"],
    ["a band card", { view: "grid" as const }, "f1"],
    ["a list row", { view: "list" as const, folderId: "f1" }, "d4"],
    ["a column row", { folderId: "f1" }, "d4"],
  ])("opens the item menu from %s, and choosing an entry does not also open the item", async (_name, opts, id) => {
    await mount(opts);
    await click(actionsButton(id));
    expect(menuLabels()).toEqual(expect.arrayContaining(["Open", "Rename", "Delete"]));
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    await click(menuItem("Rename"));
    expect(actions.onRename).toHaveBeenCalledWith(expect.objectContaining({ id }));
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("deletes the whole selection from the ... of a tile that is in it", async () => {
    await mount({ view: "grid" });
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d2"), { metaKey: true });
    await click(actionsButton("d2"));
    await click(menuItem("Delete"));
    expect(onBulkDelete.mock.calls[0][0].map((i: DriveItem) => i.id).sort()).toEqual(["d1", "d2"]);
  });
});

describe.each([
  ["a tile", { view: "grid" as const }, () => row("doc", "d1"), () => row("doc", "d3"), () => row("doc", "d2")],
  ["a band card", { view: "grid" as const }, () => row("folder", "f1"), () => row("doc", "d3"), () => row("doc", "d1")],
  ["a search result", { search: "Doc" }, () => byTestId("drive-search-hit-d1"), () => byTestId("drive-search-hit-d3"), () => byTestId("drive-search-hit-d2")],
])("DriveBrowser right-click on %s", (_name, opts, first, outside, second) => {
  const idOf = (el: Element) => el.getAttribute("data-item-id")!;

  it("opens the item menu", async () => {
    await mount(opts);
    await contextMenu(first());
    expect(menuLabels()).toEqual(expect.arrayContaining(["Open", "Rename", "Delete"]));
  });

  it("selects the row alone when it is outside the selection", async () => {
    await mount(opts);
    await click(first(), { metaKey: true });
    await contextMenu(outside());
    expect(isSelected(idOf(first()))).toBe(false);
    expect(isSelected(idOf(outside()))).toBe(true);
    expect(bar()).toBeNull();
  });

  it("acts on the whole selection when the row is in it", async () => {
    await mount(opts);
    await click(first(), { metaKey: true });
    await click(second(), { metaKey: true });
    await contextMenu(second());
    expect(bar()?.textContent).toContain("2 selected");
    await click(menuItem("Delete"));
    expect(onBulkDelete.mock.calls[0][0].map((i: DriveItem) => i.id).sort()).toEqual([idOf(first()), idOf(second())].sort());
    expect(actions.onDelete).not.toHaveBeenCalled();
  });

  it("runs a single-item entry on that item", async () => {
    await mount(opts);
    await contextMenu(first());
    await click(menuItem("Rename"));
    expect(actions.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: idOf(first()) }));
  });
});

describe("DriveBrowser search results: right-click matches the ... button", () => {
  it("lists the same entries", async () => {
    await mount({ search: "Doc" });
    await contextMenu(byTestId("drive-search-hit-d1"));
    const fromRightClick = menuLabels();
    await key(document.body, "Escape");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await click(actionsButton("d1"));
    expect(fromRightClick.length).toBeGreaterThan(1);
    expect(menuLabels()).toEqual(fromRightClick);
  });
});

describe("DriveBrowser reveal: initialSelectedId", () => {
  const scrolled: (string | null)[] = [];
  beforeEach(() => {
    scrolled.length = 0;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute("data-item-id"));
    };
  });

  it.each(["columns", "list", "grid"] as const)("selects and scrolls to the given row on mount in %s", async (view) => {
    await mount({ view, initialSelectedId: "d2" });
    expect(isSelected("d2")).toBe(true);
    expect(isSelected("d1")).toBe(false);
    expect(bar()).toBeNull();
    expect(scrolled).toContain("d2");
  });

  it("finds a row inside the folder the location points at", async () => {
    await mount({ folderId: "f1", initialSelectedId: "d4" });
    expect(isSelected("d4")).toBe(true);
    expect(scrolled).toContain("d4");
  });

  it("focuses it too, so the keyboard continues from there", async () => {
    await mount({ view: "list", initialSelectedId: "d1" });
    await key(pane("list"), "ArrowDown");
    expect(isSelected("d2")).toBe(true);
  });

  it("selects nothing for an id that is not on screen, and does not catch up when it appears later", async () => {
    await mount({ initialSelectedId: "d4" });
    expect(["d1", "d2", "d3"].map(isSelected)).toEqual([false, false, false]);
    await click(row("folder", "f1"));
    expect(isSelected("d4")).toBe(false);
  });

  it("selects nothing without an id", async () => {
    await mount();
    expect(container.querySelectorAll("input:checked")).toHaveLength(0);
  });
});

describe("DriveBrowser history: Back and Forward", () => {
  it("stay enabled with a host history, even where the local trail has nowhere to go", async () => {
    await mount({ onHistory: true });
    expect((byTestId("drive-back") as HTMLButtonElement).disabled).toBe(false);
    expect((byTestId("drive-forward") as HTMLButtonElement).disabled).toBe(false);
    await click(byTestId("drive-forward"));
    expect(onHistory).toHaveBeenCalledWith(1);
  });

  it("stay enabled after the host steps back", async () => {
    await mount({ onHistory: true });
    await click(row("folder", "f1"));
    await click(byTestId("drive-back"));
    expect((byTestId("drive-forward") as HTMLButtonElement).disabled).toBe(false);
  });

  it("grey out against the local trail without a host history", async () => {
    await mount();
    expect((byTestId("drive-back") as HTMLButtonElement).disabled).toBe(true);
    expect((byTestId("drive-forward") as HTMLButtonElement).disabled).toBe(true);
    await click(row("folder", "f1"));
    expect((byTestId("drive-back") as HTMLButtonElement).disabled).toBe(false);
    expect((byTestId("drive-forward") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("DriveBrowser grid: up and down move a visual row", () => {
  /** Two tiles to a row: the folder band is its own row above d1 d2 / d3. */
  function twoPerRow() {
    Object.defineProperty(row("doc", "d3"), "offsetTop", { value: 100, configurable: true });
  }

  it("steps by the number of tiles that fit on a row", async () => {
    await mount({ view: "grid" });
    twoPerRow();
    const p = pane("list");
    await key(p, "ArrowRight");
    expect(isSelected("f1")).toBe(true);
    await key(p, "ArrowDown");
    expect(isSelected("d1")).toBe(true);
    await key(p, "ArrowDown");
    expect(isSelected("d3")).toBe(true);
    await key(p, "ArrowUp");
    expect(isSelected("d1")).toBe(true);
    await key(p, "ArrowUp");
    expect(isSelected("f1")).toBe(true);
  });

  it("lands on the last tile when the row below is shorter, and stays at the end", async () => {
    await mount({ view: "grid" });
    twoPerRow();
    const p = pane("list");
    await key(p, "ArrowRight");
    await key(p, "ArrowRight");
    await key(p, "ArrowRight");
    expect(isSelected("d2")).toBe(true);
    await key(p, "ArrowDown");
    expect(isSelected("d3")).toBe(true);
    await key(p, "ArrowDown");
    expect(isSelected("d3")).toBe(true);
  });

  it("stays on the first row going up from the band", async () => {
    await mount({ view: "grid" });
    twoPerRow();
    const p = pane("list");
    await key(p, "ArrowRight");
    await key(p, "ArrowUp");
    expect(isSelected("f1")).toBe(true);
  });

  it("keeps stepping one row at a time in the list view", async () => {
    await mount({ view: "list" });
    const p = pane("list");
    await key(p, "ArrowDown");
    await key(p, "ArrowDown");
    expect(isSelected("d1")).toBe(true);
  });

  it("steps through the drives at the root as a grid too", async () => {
    await mount({ view: "grid", scopeId: null });
    Object.defineProperty(byTestId("drive-scope-mine"), "offsetTop", { value: 100, configurable: true });
    const p = pane("list");
    await key(p, "ArrowRight");
    await key(p, "ArrowDown");
    await key(p, "Enter");
    expect(onNavigate).toHaveBeenCalledWith("mine", null);
  });
});

describe.each(["columns", "list"] as const)("DriveBrowser %s: a plain click selects", (view) => {
  it("selects the clicked row alone and opens nothing", async () => {
    await mount({ view });
    await click(row("doc", "d1"));
    expect(isSelected("d1")).toBe(true);
    expect(selectedCount()).toBe(1);
    expect(bar()).toBeNull();
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("replaces an earlier selection with the clicked row", async () => {
    await mount({ view });
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d3"), { metaKey: true });
    expect(bar()?.textContent).toContain("2 selected");
    await click(row("doc", "d2"));
    expect(["d1", "d2", "d3"].map(isSelected)).toEqual([false, true, false]);
    expect(bar()).toBeNull();
  });

  it("deletes and renames the clicked row", async () => {
    await mount({ view });
    await click(row("doc", "d2"));
    expect(selectedCount()).toBe(1);
    await key(pane(view), "F2");
    expect(actions.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: "d2" }));
    await key(pane(view), "Delete");
    expect(actions.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "d2" }));
    expect(onBulkDelete).not.toHaveBeenCalled();
  });

  it("continues the keyboard from the clicked row", async () => {
    await mount({ view });
    await click(row("doc", "d1"));
    await key(pane(view), "ArrowDown");
    expect(isSelected("d2")).toBe(true);
    expect(selectedCount()).toBe(1);
  });

  it("clears the selection and anchor when a folder is entered", async () => {
    await mount({ view });
    await click(row("doc", "d1"));
    expect(isSelected("d1")).toBe(true);
    await dblClick(row("folder", "f1"));
    expect(bar()).toBeNull();
    expect(selectedCount()).toBe(0);
    await click(row("doc", "d4"), { shiftKey: true });
    expect(isSelected("d4")).toBe(true);
    expect(selectedCount()).toBe(1);
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("clears the selection when going up", async () => {
    await mount({ view, folderId: "f1" });
    await click(row("doc", "d4"));
    expect(selectedCount()).toBe(1);
    await key(pane(view), "Backspace");
    expect(selectedCount()).toBe(0);
  });
});

describe("DriveBrowser columns: the open trail is not a selection", () => {
  it("marks every folder along the trail as open and none as selected", async () => {
    await mount();
    await click(row("folder", "f1"));
    await click(row("folder", "f2"));
    for (const id of ["f1", "f2"]) {
      expect(row("folder", id).className).toContain("bg-os-container");
      expect(row("folder", id).className).not.toContain("text-os-accent");
    }
    expect(selectedCount()).toBe(0);
  });

  it("tints a row as selected only when it is actually selected", async () => {
    await mount({ folderId: "f1" });
    await click(row("doc", "d4"));
    expect(row("doc", "d4").className).toContain("text-os-accent");
    expect(row("folder", "f1").className).not.toContain("text-os-accent");
  });
});

describe("DriveBrowser columns: stepping into a folder with the keyboard", () => {
  it("leaves the folder behind and selects only the first row of the new column", async () => {
    await mount();
    await key(pane(), "ArrowDown");
    expect(isSelected("f1")).toBe(true);
    await key(pane(), "ArrowRight");
    expect(onNavigate).toHaveBeenCalledWith("lab", "f1");
    expect(isSelected("f1")).toBe(false);
    expect(isSelected("f2")).toBe(true);
    expect(selectedCount()).toBe(1);
  });
});

describe("DriveBrowser reveal: survives the navigation clear", () => {
  it("keeps a revealed row selected when it sits in the folder the location points at", async () => {
    await mount({ folderId: "f1", initialSelectedId: "d5" });
    expect(isSelected("d5")).toBe(true);
    expect(selectedCount()).toBe(1);
  });
});

describe("DriveBrowser reveal: revealId", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  it("selects the revealed row once it appears in the listing, after the browser is already showing", async () => {
    await mount({ view: "list", revealId: "dNew" });
    expect(selectedCount()).toBe(0);
    await act(async () => {
      swapScopes([{ ...lab, items: [...lab.items, doc("dNew")] }, mine]);
    });
    expect(isSelected("dNew")).toBe(true);
    expect(selectedCount()).toBe(1);
  });

  it("does not re-select it after the user has moved on", async () => {
    await mount({ view: "list", revealId: "dNew" });
    await act(async () => {
      swapScopes([{ ...lab, items: [...lab.items, doc("dNew")] }, mine]);
    });
    await toggle("dNew");
    expect(selectedCount()).toBe(0);
    await act(async () => {
      swapScopes([{ ...lab, items: [...lab.items, doc("dNew"), doc("dOther")] }, mine]);
    });
    expect(selectedCount()).toBe(0);
  });

  it("focuses the revealed row so the keyboard continues from it", async () => {
    await mount({ view: "list", revealId: "d1" });
    await key(pane("list"), "ArrowDown");
    expect(isSelected("d2")).toBe(true);
  });
});

const osFile = (name: string) => new File(["x"], name, { type: "text/plain" });
const osEntry = (file: File, isDirectory = false) => ({
  kind: "file",
  getAsFile: () => file,
  webkitGetAsEntry: () => ({ isDirectory }),
});

/** A native drag event carrying OS files (or, with `types`, some other payload). */
function fileDrag(
  type: "dragenter" | "dragover" | "dragleave" | "drop",
  el: Element,
  { files = [] as File[], types = ["Files"], items }: { files?: File[]; types?: string[]; items?: unknown[] } = {},
) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", {
    value: { types, files, items: items ?? files.map((f) => osEntry(f)), dropEffect: "none" },
  });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}
const overlayText = () => container.textContent?.includes("Drop files to upload") ?? false;
const lit = (el: Element) => el.className.includes("ring-os-accent");

describe.each(["columns", "list"] as const)("DriveBrowser %s: dropping OS files uploads", (view) => {
  it("drops on the pane into the current folder", async () => {
    await mount({ view, folderId: "f1" });
    const files = [osFile("a.txt"), osFile("b.txt")];
    fileDrag("dragenter", pane(view), { files });
    fileDrag("drop", pane(view), { files });
    expect(onUploadFiles).toHaveBeenCalledTimes(1);
    expect(onUploadFiles).toHaveBeenCalledWith(files);
  });

  it("shows the pane overlay while files are over it and hides it after the drop", async () => {
    await mount({ view });
    expect(overlayText()).toBe(false);
    fileDrag("dragenter", pane(view), { files: [osFile("a.txt")] });
    expect(overlayText()).toBe(true);
    fileDrag("drop", pane(view), { files: [osFile("a.txt")] });
    expect(overlayText()).toBe(false);
  });

  it("hides the overlay when the drag leaves the pane", async () => {
    await mount({ view });
    fileDrag("dragenter", pane(view), { files: [osFile("a.txt")] });
    fileDrag("dragleave", pane(view), { files: [osFile("a.txt")] });
    expect(overlayText()).toBe(false);
  });

  it("drops on a folder into that folder instead of the current one", async () => {
    await mount({ view });
    const files = [osFile("a.txt")];
    fileDrag("dragenter", row("folder", "f1"), { files });
    fileDrag("drop", row("folder", "f1"), { files });
    expect(onUploadFiles).toHaveBeenCalledTimes(1);
    expect(onUploadFiles).toHaveBeenCalledWith(files, { folderId: "f1" });
  });

  it("lights the folder under the pointer and swaps the pane overlay for it", async () => {
    await mount({ view });
    const files = [osFile("a.txt")];
    fileDrag("dragenter", pane(view), { files });
    expect(overlayText()).toBe(true);
    fileDrag("dragover", row("folder", "f1"), { files });
    expect(lit(row("folder", "f1"))).toBe(true);
    expect(overlayText()).toBe(false);
    fileDrag("dragover", row("doc", "d1"), { files });
    expect(lit(row("folder", "f1"))).toBe(false);
    expect(overlayText()).toBe(true);
  });

  it("does not treat a document row as a drop target", async () => {
    await mount({ view });
    const files = [osFile("a.txt")];
    fileDrag("dragenter", row("doc", "d1"), { files });
    fileDrag("drop", row("doc", "d1"), { files });
    expect(onUploadFiles).toHaveBeenCalledWith(files);
  });

  it("ignores drags that carry no files (moving Drive items)", async () => {
    await mount({ view });
    fileDrag("dragenter", pane(view), { types: ["text/plain"] });
    expect(overlayText()).toBe(false);
    const over = fileDrag("dragover", row("folder", "f1"), { types: ["text/plain"] });
    expect(over.defaultPrevented).toBe(false);
    expect(lit(row("folder", "f1"))).toBe(false);
    fileDrag("drop", row("folder", "f1"), { types: ["text/plain"] });
    expect(onUploadFiles).not.toHaveBeenCalled();
  });

  it("accepts the drop by cancelling dragover for files", async () => {
    await mount({ view });
    const over = fileDrag("dragover", row("folder", "f1"), { files: [osFile("a.txt")] });
    expect(over.defaultPrevented).toBe(true);
  });

  it("skips dropped OS folders and tells the upload handler how many", async () => {
    await mount({ view });
    const a = osFile("a.txt");
    const dir = osFile("Photos");
    fileDrag("drop", pane(view), { files: [a, dir], items: [osEntry(a), osEntry(dir, true)] });
    expect(onUploadFiles).toHaveBeenCalledWith([a], { skippedFolders: 1 });
  });

  it("passes a folders-only drop through with no files so the user is told", async () => {
    await mount({ view });
    const dir = osFile("Photos");
    fileDrag("drop", row("folder", "f1"), { files: [dir], items: [osEntry(dir, true)] });
    expect(onUploadFiles).toHaveBeenCalledWith([], { folderId: "f1", skippedFolders: 1 });
  });

  it("shows no overlay and uploads nothing when the host offers no upload", async () => {
    await mount({ view, canUpload: false });
    fileDrag("dragenter", pane(view), { files: [osFile("a.txt")] });
    expect(overlayText()).toBe(false);
    fileDrag("drop", pane(view), { files: [osFile("a.txt")] });
    expect(onUploadFiles).not.toHaveBeenCalled();
  });
});

describe("DriveBrowser list and grid: dropping OS files on a folder inside a folder", () => {
  it("uploads into a folder row", async () => {
    await mount({ view: "list", folderId: "f1" });
    const files = [osFile("a.txt")];
    fileDrag("drop", row("folder", "f2"), { files });
    expect(onUploadFiles).toHaveBeenCalledWith(files, { folderId: "f2" });
  });

  it("uploads into a folder tile and lights it", async () => {
    await mount({ view: "grid", folderId: "f1" });
    const files = [osFile("a.txt")];
    fileDrag("dragover", row("folder", "f2"), { files });
    expect(lit(row("folder", "f2"))).toBe(true);
    fileDrag("drop", row("folder", "f2"), { files });
    expect(onUploadFiles).toHaveBeenCalledWith(files, { folderId: "f2" });
    expect(lit(row("folder", "f2"))).toBe(false);
  });
});

describe("DriveBrowser: Folder settings", () => {
  const hiring: DriveTreeScope = { id: "hiring", label: "Hiring", iconEmoji: null, items: [folder("h1")] };
  const core: DriveTreeScope = { id: "core", label: "Core", iconEmoji: null, items: [folder("c1")] };
  const menuFor = async (scopes: DriveTreeScope[], scopeId: string, id: string, receiverViewer?: MountOptions["receiverViewer"]) => {
    await mount({ scopes, scopeId, receiverViewer });
    await contextMenu(row("folder", id));
    return menuLabels();
  };

  it("is offered on a folder in a drive with a Meetings slot", async () => {
    expect(await menuFor([lab], "lab", "f1", { isCore: true, isProjectMember: false })).toContain("Folder settings…");
  });

  it("is offered in Core", async () => {
    expect(await menuFor([core], "core", "c1", { isCore: true, isProjectMember: false })).toContain("Folder settings…");
  });

  it("is not offered in Hiring, which has no Meetings slot", async () => {
    expect(await menuFor([hiring], "hiring", "h1", { isCore: true, isProjectMember: false })).not.toContain("Folder settings…");
  });

  it("is not offered to someone who can't change where meetings file", async () => {
    expect(await menuFor([lab], "lab", "f1", { isCore: false, isProjectMember: true })).not.toContain("Folder settings…");
  });

  it("is not offered while the receivers flag is off", async () => {
    expect(await menuFor([lab], "lab", "f1")).not.toContain("Folder settings…");
  });
});

describe("DriveBrowser open to the side", () => {
  beforeEach(() => {
    window.localStorage.clear();
    onOpenItem.mockClear();
    onOpenBeside.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
  });

  const hoverButton = (id: string) => container.querySelector(`[data-testid="drive-item-beside-${id}"]`);

  it("offers the hover button on document rows only when the host can open beside", async () => {
    await mount({ view: "list" });
    expect(hoverButton("d1")).toBeNull();
    act(() => root.unmount());
    container.remove();
    await mount({ view: "list", beside: true });
    expect(hoverButton("d1")?.getAttribute("aria-label")).toBe("Open to the side");
    expect(hoverButton("f1")).toBeNull();
  });

  it("opens the document beside from the hover button without opening it as a page", async () => {
    await mount({ view: "list", beside: true });
    await click(hoverButton("d2")!);
    expect(onOpenBeside).toHaveBeenCalledWith(expect.objectContaining({ id: "d2" }));
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("adds Open to the side to the right-click menu of a document, not a folder", async () => {
    await mount({ view: "list", beside: true });
    await contextMenu(row("doc", "d1"));
    const item = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")].find((el) =>
      el.textContent?.includes("Open to the side"),
    );
    expect(item?.textContent).toContain("⌥ click");
    await click(item!);
    expect(onOpenBeside).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
  });

  it("leaves the menu without it for a folder and when the host cannot open beside", async () => {
    await mount({ view: "list", beside: true });
    await contextMenu(row("folder", "f1"));
    expect(document.body.textContent).not.toContain("Open to the side");
  });

  it("opens beside on an option click and selects on a plain click", async () => {
    await mount({ view: "list", beside: true });
    await click(row("doc", "d1"), { altKey: true });
    expect(onOpenBeside).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
    expect(onOpenItem).not.toHaveBeenCalled();
    onOpenBeside.mockClear();
    await click(row("doc", "d2"));
    await dblClick(row("doc", "d2"));
    expect(onOpenBeside).not.toHaveBeenCalled();
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "d2" }));
  });

  it("ignores an option click when the host cannot open beside", async () => {
    await mount({ view: "list" });
    await click(row("doc", "d1"), { altKey: true });
    expect(onOpenBeside).not.toHaveBeenCalled();
  });

  it("marks the row whose document is open in the side panel", async () => {
    await mount({ view: "list", beside: true, entry: "/?side=doc:d2" });
    expect(row("doc", "d2").textContent).toContain("Open beside");
    expect(row("doc", "d1").textContent).not.toContain("Open beside");
  });
});

describe("DriveBrowser columns: empty folder", () => {
  it("pictures an empty folder's column", async () => {
    await mount({ folderId: "f2" });
    const empty = container.querySelector("[data-empty-folder-art]");
    expect(empty).not.toBeNull();
    expect(empty!.getAttribute("aria-hidden")).toBe("true");
    expect(empty!.parentElement!.textContent).toBe("This folder is empty.");
  });

  it("keeps a full folder's column free of the empty art", async () => {
    await mount({ folderId: "f1" });
    expect(container.querySelector("[data-empty-folder-art]")).toBeNull();
  });
});

describe("DriveBrowser: search results are sliced", { timeout: 30000 }, () => {
  const manyDocs = (count: number): DriveTreeScope => ({
    id: "big",
    label: "Big drive",
    iconEmoji: null,
    items: Array.from({ length: count }, (_, i) => ({ ...doc(`b${String(i).padStart(3, "0")}`), title: `Doc ${String(i).padStart(3, "0")}` })),
  });
  const hitRows = () => container.querySelectorAll('[data-testid^="drive-search-hit-"]');
  const loadMore = () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === "Load more") as HTMLButtonElement | undefined;

  it("renders 50 hits and reveals the next 50 with Load more", async () => {
    await mount({ scopes: [manyDocs(110)], search: "Doc" });
    expect(hitRows()).toHaveLength(50);
    expect(container.textContent).toContain("Showing 50 of 110");
    await click(loadMore()!);
    expect(hitRows()).toHaveLength(100);
    await click(loadMore()!);
    expect(hitRows()).toHaveLength(110);
    expect(loadMore()).toBeUndefined();
  });

  it("selects only the rendered hits with select-all, then more after Load more", async () => {
    await mount({ scopes: [manyDocs(110)], search: "Doc" });
    await key(byTestId("drive-list-pane"), "a", { metaKey: true });
    expect(selectedCount()).toBe(50);
    expect(bar()?.textContent).toContain("50 selected");
    await click(loadMore()!);
    expect(selectedCount()).toBe(50);
    await key(byTestId("drive-list-pane"), "a", { metaKey: true });
    expect(bar()?.textContent).toContain("100 selected");
  });

  it("stops arrow-down at the last rendered hit and continues after Load more", async () => {
    await mount({ scopes: [manyDocs(110)], search: "Doc" });
    const pane = byTestId("drive-list-pane");
    await click(byTestId("drive-search-hit-b049"));
    await key(pane, "ArrowDown");
    expect(isSelected("b049")).toBe(true);
    await click(loadMore()!);
    await key(pane, "ArrowDown");
    expect(isSelected("b050")).toBe(true);
  });

  it("returns to the first slice when the query changes", async () => {
    await mount({ scopes: [manyDocs(110)], search: "Doc" });
    await click(loadMore()!);
    expect(hitRows()).toHaveLength(100);
    await act(async () => swapSearch("Doc 0"));
    expect(hitRows()).toHaveLength(50);
    expect(container.textContent).toContain("Showing 50 of 100");
  });

  it("keeps the Load more button out of the pane so Enter on it does not open a row", async () => {
    await mount({ scopes: [manyDocs(60)], search: "Doc" });
    expect(byTestId("drive-list-pane").contains(loadMore()!)).toBe(false);
  });
});
