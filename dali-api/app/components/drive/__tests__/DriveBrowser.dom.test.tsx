// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { DriveBrowser } from "~/components/drive/DriveBrowser";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = new Date("2026-01-01T00:00:00Z");
const doc = (id: string): DriveItem => ({
  type: "doc", id, title: `Doc ${id}`, parentFolderId: null, iconEmoji: null, updatedAt: at, href: `/documents/${id}`,
});
const folder = (id: string, extra: Partial<DriveItem> = {}): DriveItem =>
  ({
    type: "folder", id, title: `Folder ${id}`, parentFolderId: null, iconEmoji: null, updatedAt: at, href: `/documents/${id}`,
    audience: { kind: "lab", label: "Everyone in the lab", permission: "View" },
    ...extra,
  }) as DriveItem;

const scope: DriveTreeScope = {
  id: "lab",
  label: "Lab-wide",
  iconEmoji: null,
  items: [folder("f1"), doc("d1"), doc("d2"), doc("d3")],
};
const actions = { onRename: vi.fn(), onRequestMove: vi.fn(), onDelete: vi.fn() };

let container: HTMLDivElement;
let root: Root;
const onOpenItem = vi.fn();
const onBulkMove = vi.fn();
const onBulkDelete = vi.fn();

async function mount() {
  const scopes = [scope];
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () =>
        createElement(DriveBrowser, {
          scopes,
          currentScopeId: "lab",
          currentFolderId: null,
          typeFilter: "all",
          search: "",
          onSearchChange: vi.fn(),
          onNavigate: vi.fn(),
          onOpenItem,
          onMove: vi.fn(),
          getScopeActions: () => actions,
          onBulkMove,
          onBulkDelete,
        }),
    },
  ]);
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

const row = (type: string, id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="drive-item-${type}-${id}"]`)!;
const click = (el: Element, init: MouseEventInit = {}) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  });
const dblClick = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  });
const bar = () => container.querySelector('[data-testid="drive-bulk-bar"]');

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

describe("DriveBrowser columns: click selects, double-click opens", () => {
  it("does not open a document on a plain click", async () => {
    await mount();
    await click(row("doc", "d1"));
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(bar()).toBeNull();
  });

  it("opens a document on double-click", async () => {
    await mount();
    await dblClick(row("doc", "d1"));
    expect(onOpenItem).toHaveBeenCalledTimes(1);
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
  });

  it("does not open a folder on double-click", async () => {
    await mount();
    await dblClick(row("folder", "f1"));
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("builds a multi-selection with cmd-click without opening anything", async () => {
    await mount();
    await click(row("doc", "d1"));
    await click(row("doc", "d2"), { metaKey: true });
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(bar()?.textContent).toContain("2 selected");
    await click(row("doc", "d3"), { ctrlKey: true });
    expect(bar()?.textContent).toContain("3 selected");
    await click(row("doc", "d3"), { ctrlKey: true });
    expect(bar()?.textContent).toContain("2 selected");
  });

  it("extends a range with shift-click from the anchor in the same column", async () => {
    await mount();
    await click(row("doc", "d1"));
    await click(row("doc", "d3"), { shiftKey: true });
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(bar()?.textContent).toContain("3 selected");
  });

  it("treats shift-click with no anchor as a plain select", async () => {
    await mount();
    await click(row("doc", "d2"), { shiftKey: true });
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(bar()).toBeNull();
  });

  it("collapses a multi-selection back to one row on a plain click", async () => {
    await mount();
    await click(row("doc", "d1"));
    await click(row("doc", "d2"), { metaKey: true });
    await click(row("doc", "d3"));
    expect(bar()).toBeNull();
    expect(onOpenItem).not.toHaveBeenCalled();
  });
});

describe("DriveBrowser bulk bar", () => {
  async function selectTwo() {
    await mount();
    await click(row("doc", "d1"));
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
    await dblClick(row("doc", "d1").querySelector('[data-testid="item-glyph"]')!);
    expect(onOpenItem).toHaveBeenCalledTimes(1);
  });
});
