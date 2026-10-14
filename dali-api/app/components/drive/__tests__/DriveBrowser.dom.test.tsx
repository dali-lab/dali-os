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
const onBulkMove = vi.fn();
const onBulkDelete = vi.fn();
const onNavigate = vi.fn();
const onHistory = vi.fn();
const onMove = vi.fn();
const onMoveToScope = vi.fn();

type MountOptions = {
  view?: "columns" | "list" | "grid";
  scopeId?: string | null;
  folderId?: string | null;
  search?: string;
  onHistory?: boolean;
  initialSelectedId?: string;
  typeFilter?: DriveTypeFilter;
  scopes?: DriveTreeScope[];
};

/** The browser at a location, with `onNavigate` moving it the way the hub's URL does. */
async function mount(opts: MountOptions = {}) {
  if (opts.view && opts.view !== "columns") window.localStorage.setItem("dali_drive_view", opts.view);
  function Harness() {
    const [loc, setLoc] = useState({ scopeId: opts.scopeId === undefined ? "lab" : opts.scopeId, folderId: opts.folderId ?? null });
    return createElement(ToastProvider, null, createElement(DialogProvider, null, createElement(DriveBrowser, {
      scopes: opts.scopes ?? [lab, mine],
      currentScopeId: loc.scopeId,
      currentFolderId: loc.folderId,
      typeFilter: opts.typeFilter ?? "all",
      search: opts.search ?? "",
      onSearchChange: vi.fn(),
      onNavigate: (scopeId: string | null, folderId: string | null) => {
        onNavigate(scopeId, folderId);
        setLoc({ scopeId, folderId });
      },
      onHistory: opts.onHistory ? onHistory : undefined,
      initialSelectedId: opts.initialSelectedId,
      onMove,
      onMoveToScope,
      onOpenItem,
      getScopeActions: () => actions,
      onBulkMove,
      onBulkDelete,
    })));
  }
  const Stub = createRoutesStub([{ path: "/", Component: Harness }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
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
const checkbox = (id: string) => container.querySelector<HTMLInputElement>(`input[aria-label="Select Doc ${id}"], input[aria-label="Select Folder ${id}"]`)!;
const isChecked = (id: string) => checkbox(id).checked;
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

describe.each(["columns", "list"] as const)("DriveBrowser %s: click opens, modifiers select", (view) => {
  it("opens a document on a plain click", async () => {
    await mount({ view });
    await click(row("doc", "d1"));
    expect(onOpenItem).toHaveBeenCalledTimes(1);
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
  });

  it("navigates into a folder on a plain click", async () => {
    await mount({ view });
    await click(row("folder", "f1"));
    expect(onNavigate).toHaveBeenCalledWith("lab", "f1");
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("does nothing extra on double-click", async () => {
    await mount({ view });
    await dblClick(row("doc", "d1"));
    await dblClick(row("folder", "f1"));
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
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
    await click(row("doc", "d1"), { metaKey: true });
    await click(row("doc", "d3"), { shiftKey: true });
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(bar()?.textContent).toContain("3 selected");
    expect(["d1", "d2", "d3"].map(isChecked)).toEqual([true, true, true]);
  });

  it("treats shift-click with no anchor as a plain click", async () => {
    await mount({ view });
    await click(row("doc", "d2"), { shiftKey: true });
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "d2" }));
  });

  it("selects with the hover checkbox without opening", async () => {
    await mount({ view });
    expect(isChecked("d1")).toBe(false);
    await click(checkbox("d1"));
    expect(isChecked("d1")).toBe(true);
    await click(checkbox("d2"));
    expect(bar()?.textContent).toContain("2 selected");
    await click(checkbox("d2"));
    expect(bar()).toBeNull();
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("extends from the anchor with shift on the checkbox", async () => {
    await mount({ view });
    await click(checkbox("d1"));
    await click(checkbox("d3"), { shiftKey: true });
    expect(bar()?.textContent).toContain("3 selected");
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("clears the selection on a click on empty space deeper than a drive's top level", async () => {
    await mount({ view, folderId: "f1" });
    await click(checkbox("d4"));
    expect(isChecked("d4")).toBe(true);
    await click(pane(view));
    expect(isChecked("d4")).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("goes back to the list of drives on a click on empty space at a drive's top level", async () => {
    await mount({ view });
    await click(checkbox("d1"));
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
    expect(isChecked("d1")).toBe(false);
    expect(isChecked("d3")).toBe(true);
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
    expect(isChecked(first)).toBe(true);
    await key(p, "ArrowDown");
    await key(p, "ArrowDown");
    expect(isChecked("d2")).toBe(true);
    expect(isChecked("f1")).toBe(false);
    expect(bar()).toBeNull();
    await key(p, "ArrowUp");
    expect(isChecked("d1")).toBe(true);
    expect(isChecked("d2")).toBe(false);
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
    expect(isChecked("d1")).toBe(false);
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
    await click(checkbox("d3"));
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
    expect(isChecked("d1")).toBe(true);
    await key(p, "f");
    expect(isChecked("d1")).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("starts a fresh type-ahead after a second of silence", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await mount({ view });
      const p = pane(view);
      await key(p, "f");
      expect(isChecked("f1")).toBe(true);
      vi.setSystemTime(Date.now() + 1500);
      await key(p, "d");
      expect(isChecked("d1")).toBe(true);
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
    await click(checkbox("d4"));
    await key(p, "ArrowLeft");
    expect(isChecked("f1")).toBe(true);
    expect(isChecked("d4")).toBe(false);
    await key(p, "ArrowDown");
    expect(isChecked("d1")).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
    await key(p, "ArrowUp");
    await key(p, "ArrowUp");
    expect(isChecked("f1")).toBe(true);
    await key(p, "ArrowRight");
    expect(isChecked("f2")).toBe(true);
  });

  it("enters a folder with the right arrow when it is not open yet", async () => {
    await mount();
    const p = pane();
    await key(p, "ArrowDown");
    await key(p, "ArrowRight");
    expect(onNavigate).toHaveBeenCalledWith("lab", "f1");
    expect(isChecked("f2")).toBe(true);
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

  it("labels a notebook in the details rail with its tab count", async () => {
    const notebook = (id: string, tabCount: number) => ({ ...doc(id), isNotebook: true, tabCount }) as DriveItem;
    await mount({ scopes: [{ ...lab, items: [notebook("n1", 1), notebook("n3", 3), doc("d1")] }, mine] });
    await click(byTestId("drive-details-toggle"));
    await click(row("doc", "n1"), { metaKey: true });
    expect(byTestId("drive-details-pane").textContent).toContain("Notebook · 1 tab");
    expect(byTestId("drive-details-pane").textContent).not.toContain("Notebook · 1 tabs");
    await click(row("doc", "n1"), { metaKey: true });
    await click(row("doc", "n3"), { metaKey: true });
    expect(byTestId("drive-details-pane").textContent).toContain("Notebook · 3 tabs");
    await click(row("doc", "n3"), { metaKey: true });
    await click(row("doc", "d1"), { metaKey: true });
    expect(byTestId("drive-details-pane").textContent).toContain("Document");
  });

  it("shows the focused item in the details rail", async () => {
    await mount();
    await click(byTestId("drive-details-toggle"));
    expect(byTestId("drive-details-pane").textContent).toContain("Select an item");
    await click(row("doc", "d2"), { metaKey: true });
    expect(byTestId("drive-details-pane").textContent).toContain("Doc d2");
    await click(row("doc", "d1"), { metaKey: true });
    expect(byTestId("drive-details-pane").textContent).toContain("Select an item");
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
    expect(["f1", "d1", "d2", "d3"].map(isChecked)).toEqual([false, false, true, true]);
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
    expect(["f1", "d1", "d2", "d3"].map(isChecked)).toEqual([false, true, true, true]);
  });

  it("replaces the selection, or adds to it when shift was held at pointer-down", async () => {
    await mount();
    const col = byTestId("drive-col-1");
    layOut(col, [row("folder", "f1"), row("doc", "d1"), row("doc", "d2"), row("doc", "d3")]);
    await click(checkbox("d1"));
    await pointer(col, "pointerdown", 10, 200);
    await pointer(col, "pointermove", 10, 75);
    await pointer(col, "pointerup", 10, 75);
    expect(["d1", "d2", "d3"].map(isChecked)).toEqual([false, true, true]);
    await pointer(col, "pointerdown", 10, 130, { shiftKey: true });
    await pointer(col, "pointermove", 10, 100, { shiftKey: true });
    await pointer(col, "pointerup", 10, 100, { shiftKey: true });
    expect(["d1", "d2", "d3"].map(isChecked)).toEqual([false, true, true]);
    await click(checkbox("d1"));
    await pointer(col, "pointerdown", 10, 200, { metaKey: true });
    await pointer(col, "pointermove", 10, 100, { metaKey: true });
    await pointer(col, "pointerup", 10, 100, { metaKey: true });
    expect(["d1", "d2", "d3"].map(isChecked)).toEqual([true, true, true]);
  });

  it("never starts from a row, from its checkbox, or from the bulk bar", async () => {
    await mount();
    const col = byTestId("drive-col-1");
    layOut(col, [row("folder", "f1"), row("doc", "d1"), row("doc", "d2"), row("doc", "d3")]);
    await pointer(row("doc", "d1"), "pointerdown", 10, 45);
    await pointer(row("doc", "d1"), "pointermove", 10, 100);
    await pointer(row("doc", "d1"), "pointerup", 10, 100);
    await pointer(checkbox("d2"), "pointerdown", 10, 75);
    await pointer(checkbox("d2"), "pointermove", 10, 120);
    await pointer(checkbox("d2"), "pointerup", 10, 120);
    expect(bar()).toBeNull();
    expect(["d1", "d2", "d3"].map(isChecked)).toEqual([false, false, false]);
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
    expect(isChecked("d4")).toBe(true);
    expect(bar()).toBeNull();
    await click(byTestId("drive-view-columns"));
    expect(isChecked("d4")).toBe(true);
    expect(isChecked("d1")).toBe(false);
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
    expect(isChecked("d1")).toBe(true);
    await click(byTestId("drive-search-hit-d2"));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "d2" }));
  });

  it("enters a drive with a plain click on its row at the root", async () => {
    await mount({ view: "list", scopeId: null });
    await click(byTestId("drive-scope-lab"));
    expect(onNavigate).toHaveBeenCalledWith("lab", null);
  });

  it("enters a folder from the band at a drive's top level with a plain click", async () => {
    await mount({ view: "grid" });
    await click(row("folder", "f1"));
    expect(onNavigate).toHaveBeenCalledWith("lab", "f1");
  });

  it("selects a band card and a tile with their checkboxes in the grid", async () => {
    await mount({ view: "grid" });
    await click(checkbox("f1"));
    await click(checkbox("d1"));
    expect(bar()?.textContent).toContain("2 selected");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("moves along a grid row with the left and right arrows", async () => {
    await mount({ view: "grid" });
    const p = pane("list");
    await key(p, "ArrowRight");
    expect(isChecked("f1")).toBe(true);
    await key(p, "ArrowRight");
    expect(isChecked("d1")).toBe(true);
    await key(p, "ArrowLeft");
    expect(isChecked("f1")).toBe(true);
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

  it("leaves row clicks working through the glyph wrapper", async () => {
    await mount();
    await click(row("doc", "d1").querySelector('[data-testid="item-glyph"]')!);
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

describe("DriveBrowser: the checkbox has its own slot before the glyph", () => {
  const leadViews = [
    ["columns", { view: "columns" as const }, () => row("folder", "f1")],
    ["list", { view: "list" as const, folderId: "f1" }, () => row("folder", "f2")],
    ["search", { search: "Folder" }, () => byTestId("drive-search-hit-f1")],
  ] as const;

  describe.each(leadViews)("%s", (_name, opts, target) => {
    it("keeps a fixed-width slot that does not hold the glyph", async () => {
      await mount(opts);
      const slot = target().querySelector("[data-marquee-ignore]")!;
      expect(slot.className).toContain("w-5");
      expect(slot.className).toContain("shrink-0");
      expect(slot.querySelector('[data-testid="item-glyph"]')).toBeNull();
      expect(slot.nextElementSibling?.querySelector('[data-testid="item-glyph"]') ?? slot.nextElementSibling).toBe(
        target().querySelector('[data-testid="item-glyph"]')!.parentElement === slot.nextElementSibling
          ? slot.nextElementSibling
          : target().querySelector('[data-testid="item-glyph"]'),
      );
    });

    it("shows the checkbox on hover, on focus within, or when selected, and holds its place otherwise", async () => {
      await mount(opts);
      const slot = target().querySelector("[data-marquee-ignore]") as HTMLElement;
      expect(slot.className).toContain("opacity-0");
      expect(slot.className).toContain("group-hover:opacity-100");
      expect(slot.className).toContain("focus-within:opacity-100");
      await click(slot.querySelector("input")!);
      expect(slot.className).toContain("opacity-100");
      expect(slot.className).not.toContain("opacity-0");
    });

    it("leaves the glyph uncovered so its tooltip shows on hover", async () => {
      await mount(opts);
      const glyph = target().querySelector('[data-testid="item-glyph"]')!;
      expect(glyph.closest('[class*="group-hover:opacity-0"]')).toBeNull();
      await hoverGlyph(target());
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Folder · Everyone in the lab");
    });
  });

  it("keeps a tile's and a band card's checkbox in the top-left corner", async () => {
    await mount({ view: "grid" });
    for (const el of [row("folder", "f1"), row("doc", "d1")]) {
      const box = el.querySelector("[data-marquee-ignore]")!;
      expect(box.className).toContain("absolute");
      expect(box.className).toContain("left-1.5");
      expect(box.className).toContain("top-1.5");
    }
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
    expect(row("folder", to).className).toContain("ring-accent-coral");
    expect(row("folder", to).className).toContain("bg-accent-coral/10");
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
    expect(row("folder", "f1").className).toContain("ring-accent-coral");
    await mouse(document, "mousemove", 300);
    expect(row("folder", "f1").className).not.toContain("ring-accent-coral");
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
    expect(row("folder", "f3").className).toContain("ring-accent-coral");
    expect(row("folder", "f1").className).not.toContain("ring-accent-coral");
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
      expect(row("doc", "nb1").className).toContain("ring-accent-coral");
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
    expect(row("doc", "d2").className).not.toContain("ring-accent-coral");
    await release();
  });
});

describe("DriveBrowser drag: dropping on the breadcrumb", () => {
  it("moves to the drive's top level from its crumb, with the same ring", async () => {
    await mount({ view: "list", folderId: "f1" });
    place(row("doc", "d4"), 0);
    place(byTestId("drive-crumb-scope"), 100);
    await carry(row("doc", "d4"), 100);
    expect(byTestId("drive-crumb-scope").className).toContain("ring-accent-coral");
    await release();
    expect(onMove).toHaveBeenCalledWith("lab", [expect.objectContaining({ id: "d4" })], null);
  });

  it("does not take drops on the root Drive crumb, since nothing moves to the list of drives", async () => {
    await mount({ view: "list", folderId: "f1" });
    place(row("doc", "d4"), 0);
    place(crumbRoot()!, 100);
    await carry(row("doc", "d4"), 100);
    expect(crumbRoot()!.className).not.toContain("ring-accent-coral");
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
    expect(byTestId("drive-scope-mine").className).toContain("ring-accent-coral");
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
      expect(byTestId("drive-scope-mine").className).toContain("ring-accent-coral");
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
      expect(byTestId(`drive-scope-${id}`).className).not.toContain("ring-accent-coral");
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
    expect(isChecked(idOf(first()))).toBe(false);
    expect(isChecked(idOf(outside()))).toBe(true);
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
    expect(isChecked("d2")).toBe(true);
    expect(isChecked("d1")).toBe(false);
    expect(bar()).toBeNull();
    expect(scrolled).toContain("d2");
  });

  it("finds a row inside the folder the location points at", async () => {
    await mount({ folderId: "f1", initialSelectedId: "d4" });
    expect(isChecked("d4")).toBe(true);
    expect(scrolled).toContain("d4");
  });

  it("focuses it too, so the keyboard continues from there", async () => {
    await mount({ view: "list", initialSelectedId: "d1" });
    await key(pane("list"), "ArrowDown");
    expect(isChecked("d2")).toBe(true);
  });

  it("selects nothing for an id that is not on screen, and does not catch up when it appears later", async () => {
    await mount({ initialSelectedId: "d4" });
    expect(["d1", "d2", "d3"].map(isChecked)).toEqual([false, false, false]);
    await click(row("folder", "f1"));
    expect(isChecked("d4")).toBe(false);
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
    expect(isChecked("f1")).toBe(true);
    await key(p, "ArrowDown");
    expect(isChecked("d1")).toBe(true);
    await key(p, "ArrowDown");
    expect(isChecked("d3")).toBe(true);
    await key(p, "ArrowUp");
    expect(isChecked("d1")).toBe(true);
    await key(p, "ArrowUp");
    expect(isChecked("f1")).toBe(true);
  });

  it("lands on the last tile when the row below is shorter, and stays at the end", async () => {
    await mount({ view: "grid" });
    twoPerRow();
    const p = pane("list");
    await key(p, "ArrowRight");
    await key(p, "ArrowRight");
    await key(p, "ArrowRight");
    expect(isChecked("d2")).toBe(true);
    await key(p, "ArrowDown");
    expect(isChecked("d3")).toBe(true);
    await key(p, "ArrowDown");
    expect(isChecked("d3")).toBe(true);
  });

  it("stays on the first row going up from the band", async () => {
    await mount({ view: "grid" });
    twoPerRow();
    const p = pane("list");
    await key(p, "ArrowRight");
    await key(p, "ArrowUp");
    expect(isChecked("f1")).toBe(true);
  });

  it("keeps stepping one row at a time in the list view", async () => {
    await mount({ view: "list" });
    const p = pane("list");
    await key(p, "ArrowDown");
    await key(p, "ArrowDown");
    expect(isChecked("d1")).toBe(true);
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

const checkedCount = () => container.querySelectorAll("input:checked").length;

describe.each(["columns", "list"] as const)("DriveBrowser %s: a plain click focuses but never selects", (view) => {
  it("leaves nothing selected after opening a folder or a document", async () => {
    await mount({ view });
    await click(row("folder", "f1"));
    expect(checkedCount()).toBe(0);
    expect(bar()).toBeNull();
    await click(row("doc", "d4"));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "d4" }));
    expect(checkedCount()).toBe(0);
  });

  it("drops a selection made earlier instead of replacing it with the clicked row", async () => {
    await mount({ view });
    await click(checkbox("d1"));
    await click(row("doc", "d2"));
    expect(checkedCount()).toBe(0);
  });

  it("still deletes, renames and details the clicked row, since it holds the focus", async () => {
    await mount({ view });
    await click(byTestId("drive-details-toggle"));
    await click(row("doc", "d2"));
    expect(checkedCount()).toBe(0);
    expect(byTestId("drive-details-pane").textContent).toContain("Doc d2");
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
    expect(isChecked("d2")).toBe(true);
    expect(checkedCount()).toBe(1);
  });

  it("clears the selection and anchor when a folder is entered", async () => {
    await mount({ view });
    await click(checkbox("d1"));
    expect(isChecked("d1")).toBe(true);
    await click(row("folder", "f1"));
    expect(bar()).toBeNull();
    expect(checkedCount()).toBe(0);
    await click(row("doc", "d4"), { shiftKey: true });
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "d4" }));
    expect(checkedCount()).toBe(0);
  });

  it("clears the selection when going up", async () => {
    await mount({ view, folderId: "f1" });
    await click(checkbox("d4"));
    await key(pane(view), "Backspace");
    expect(checkedCount()).toBe(0);
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
    expect(checkedCount()).toBe(0);
  });

  it("tints a row as selected only when it is actually selected", async () => {
    await mount({ folderId: "f1" });
    await click(checkbox("d4"));
    expect(row("doc", "d4").className).toContain("text-os-accent");
    expect(row("folder", "f1").className).not.toContain("text-os-accent");
  });
});

describe("DriveBrowser columns: stepping into a folder with the keyboard", () => {
  it("leaves the folder behind and selects only the first row of the new column", async () => {
    await mount();
    await key(pane(), "ArrowDown");
    expect(isChecked("f1")).toBe(true);
    await key(pane(), "ArrowRight");
    expect(onNavigate).toHaveBeenCalledWith("lab", "f1");
    expect(isChecked("f1")).toBe(false);
    expect(isChecked("f2")).toBe(true);
    expect(checkedCount()).toBe(1);
  });
});

describe("DriveBrowser reveal: survives the navigation clear", () => {
  it("keeps a revealed row selected when it sits in the folder the location points at", async () => {
    await mount({ folderId: "f1", initialSelectedId: "d5" });
    expect(isChecked("d5")).toBe(true);
    expect(checkedCount()).toBe(1);
  });
});
