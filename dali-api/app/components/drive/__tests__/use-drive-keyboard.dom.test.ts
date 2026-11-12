// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useDriveKeyboard, type DriveKeyboardOptions } from "~/components/drive/use-drive-keyboard";
import type { DriveItem } from "~/drive/lib/drive.server";
import { renderHook } from "./render-hook";

const at = new Date("2026-01-01T00:00:00Z");
const item = (type: DriveItem["type"], id: string, title = id): DriveItem =>
  ({ type, id, title, parentFolderId: null, iconEmoji: null, updatedAt: at, href: `/x/${id}` }) as DriveItem;
const items = [item("doc", "apple"), item("doc", "banana"), item("doc", "berry"), item("folder", "cherry"), item("file", "pic.png")];
const entry = (it: DriveItem) => ({ item: it, scopeId: "lab" });

function setup(over: Partial<DriveKeyboardOptions> = {}) {
  const calls = {
    focusOnly: vi.fn(),
    clearSelection: vi.fn(),
    setSelected: vi.fn(),
    setPreviewItem: vi.fn(),
    goUp: vi.fn(),
    openById: vi.fn(),
    onOpenItem: vi.fn(),
    onBulkDelete: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    openFolderInColumn: vi.fn(),
    setFocusLevel: vi.fn(),
  };
  const options: DriveKeyboardOptions = {
    searching: false,
    columnsActive: false,
    viewMode: "list",
    hits: [],
    listing: items,
    scopes: [{ id: "lab", label: "Lab", iconEmoji: null, items }],
    currentScope: { id: "lab", label: "Lab", iconEmoji: null, items },
    levels: [{ kind: "root" }, { kind: "scope", scopeId: "lab", folderId: null }],
    focusLevel: 1,
    setFocusLevel: calls.setFocusLevel,
    levelRows: () => items.map((i) => ({ id: i.id, title: i.title })),
    itemsForLevel: () => items,
    itemIndex: new Map(items.map((i) => [i.id, entry(i)])),
    focusId: null,
    focusEntry: null,
    selectedItems: [],
    focusOnly: calls.focusOnly,
    clearSelection: calls.clearSelection,
    setSelected: calls.setSelected,
    previewItem: null,
    setPreviewItem: calls.setPreviewItem,
    listRef: { current: null },
    goUp: calls.goUp,
    openById: calls.openById,
    openFolderInColumn: calls.openFolderInColumn,
    onOpenItem: calls.onOpenItem,
    onBulkDelete: calls.onBulkDelete,
    getInternalScopeActions: () => ({ onDelete: calls.onDelete, onRename: calls.onRename }) as never,
    ...over,
  };
  const hook = renderHook(useDriveKeyboard, { initialProps: options });
  mounted.push(hook.unmount);
  return { calls, key: keyPress(hook.result), options };
}

const mounted: Array<() => void> = [];
afterEach(() => mounted.splice(0).forEach((u) => u()));

function keyPress(result: { current: ReturnType<typeof useDriveKeyboard> }) {
  return (key: string, init: Partial<KeyboardEvent> = {}, target: Element = document.body) => {
    const preventDefault = vi.fn();
    const e = { key, metaKey: false, ctrlKey: false, altKey: false, target, preventDefault, ...init } as unknown as ReactKeyboardEvent<HTMLElement>;
    act(() => result.current.onPaneKeyDown(e));
    return preventDefault;
  };
}

describe("useDriveKeyboard", () => {
  it("moves focus down and up one row, selecting it, and stops at the ends", () => {
    const { calls, key } = setup({ focusId: "banana" });
    key("ArrowDown");
    expect(calls.focusOnly).toHaveBeenLastCalledWith("berry", true);
    key("ArrowUp");
    expect(calls.focusOnly).toHaveBeenLastCalledWith("apple", true);
  });

  it("starts at the first row when nothing is focused, and clamps at the last", () => {
    const first = setup();
    first.key("ArrowDown");
    expect(first.calls.focusOnly).toHaveBeenLastCalledWith("apple", true);
    const last = setup({ focusId: "pic.png" });
    last.key("ArrowDown");
    expect(last.calls.focusOnly).toHaveBeenLastCalledWith("pic.png", true);
  });

  it("walks the drives at the root without selecting them", () => {
    const { calls, key } = setup({ currentScope: null, focusId: null });
    key("ArrowDown");
    expect(calls.focusOnly).toHaveBeenLastCalledWith("lab", false);
  });

  it("opens the focused row with Enter outside columns", () => {
    const { calls, key } = setup({ focusId: "apple" });
    key("Enter");
    expect(calls.openById).toHaveBeenCalledWith("apple");
  });

  it("selects every row with cmd-A, but not where rows are not selectable", () => {
    const a = setup();
    a.key("a", { metaKey: true });
    expect(a.calls.setSelected).toHaveBeenCalledWith(new Set(items.map((i) => i.id)));
    const b = setup({ currentScope: null });
    b.key("a", { metaKey: true });
    expect(b.calls.setSelected).not.toHaveBeenCalled();
  });

  it("goes up with Backspace and cmd-up, and clears with Escape", () => {
    const { calls, key } = setup();
    key("Backspace");
    key("ArrowUp", { metaKey: true });
    expect(calls.goUp).toHaveBeenCalledTimes(2);
    key("Escape");
    expect(calls.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("closes Quick Look with Escape before touching the selection", () => {
    const { calls, key } = setup({ previewItem: items[4] });
    key("Escape");
    expect(calls.setPreviewItem).toHaveBeenCalledWith(null);
    expect(calls.clearSelection).not.toHaveBeenCalled();
  });

  it("opens Quick Look on space for an image only", () => {
    const img = setup({ focusId: "pic.png", focusEntry: entry(items[4]) });
    img.key("Escape");
    const space = img.key(" ");
    expect(img.calls.setPreviewItem).toHaveBeenLastCalledWith(items[4]);
    expect(space).toHaveBeenCalled();
    const docFocus = setup({ focusId: "apple", focusEntry: entry(items[0]) });
    docFocus.key(" ");
    expect(docFocus.calls.setPreviewItem).not.toHaveBeenCalled();
  });

  it("deletes the whole selection through the bulk path, or the single row through its item path", () => {
    const many = setup({ selectedItems: [items[0], items[1]] });
    many.key("Delete");
    expect(many.calls.onBulkDelete).toHaveBeenCalledWith([items[0], items[1]]);
    const one = setup({ selectedItems: [items[0]] });
    one.key("Delete");
    expect(one.calls.onDelete).toHaveBeenCalledWith(items[0]);
    expect(one.calls.onBulkDelete).not.toHaveBeenCalled();
  });

  it("renames the focused row with F2", () => {
    const { calls, key } = setup({ focusId: "apple", focusEntry: entry(items[0]) });
    key("F2");
    expect(calls.onRename).toHaveBeenCalledWith(items[0]);
  });

  it("jumps by typed letters, buffering letters typed together", () => {
    const { calls, key } = setup();
    key("b");
    expect(calls.focusOnly).toHaveBeenLastCalledWith("banana", true);
    key("e");
    expect(calls.focusOnly).toHaveBeenLastCalledWith("berry", true);
  });

  it("starts a fresh buffer after a second", () => {
    vi.useFakeTimers();
    try {
      const { calls, key } = setup();
      key("b");
      vi.setSystemTime(Date.now() + 1500);
      key("c");
      expect(calls.focusOnly).toHaveBeenLastCalledWith("cherry", true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores keys typed into an input", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const { calls, key } = setup();
    key("Delete", {}, input);
    key("b", {}, input);
    expect(calls.onBulkDelete).not.toHaveBeenCalled();
    expect(calls.focusOnly).not.toHaveBeenCalled();
    input.remove();
  });

  describe("columns", () => {
    const columns = { columnsActive: true, viewMode: "columns" as const };

    it("steps into a focused folder with the right arrow and focuses its first row", () => {
      const { calls, key } = setup({ ...columns, focusId: "cherry", focusEntry: entry(items[3]), itemsForLevel: () => [items[0]] });
      key("ArrowRight");
      expect(calls.openFolderInColumn).toHaveBeenCalledWith(1, "lab", "cherry");
      expect(calls.setFocusLevel).toHaveBeenCalledWith(2);
      expect(calls.focusOnly).toHaveBeenCalledWith("apple");
    });

    it("does not open a document with the right arrow, but does with Enter", () => {
      const { calls, key } = setup({ ...columns, focusId: "apple", focusEntry: entry(items[0]) });
      key("ArrowRight");
      expect(calls.onOpenItem).not.toHaveBeenCalled();
      key("Enter");
      expect(calls.onOpenItem).toHaveBeenCalledWith(items[0]);
    });

    it("steps left to the folder that is open in the parent column", () => {
      const { calls, key } = setup({
        ...columns,
        focusLevel: 2,
        levels: [{ kind: "root" }, { kind: "scope", scopeId: "lab", folderId: null }, { kind: "scope", scopeId: "lab", folderId: "cherry" }],
        focusId: "x",
      });
      key("ArrowLeft");
      expect(calls.setFocusLevel).toHaveBeenCalledWith(1);
      expect(calls.focusOnly).toHaveBeenCalledWith("cherry", true);
    });

    it("clears the selection when the entered folder is empty", () => {
      const { calls, key } = setup({ ...columns, focusId: "cherry", focusEntry: entry(items[3]), itemsForLevel: () => [] });
      key("ArrowRight");
      expect(calls.clearSelection).toHaveBeenCalled();
    });
  });

  it("moves along a grid row with left and right", () => {
    const { calls, key } = setup({ viewMode: "grid", focusId: "banana" });
    key("ArrowRight");
    expect(calls.focusOnly).toHaveBeenLastCalledWith("berry", true);
    key("ArrowLeft");
    expect(calls.focusOnly).toHaveBeenLastCalledWith("apple", true);
  });

  it("ignores left and right in the list", () => {
    const { calls, key } = setup({ focusId: "banana" });
    key("ArrowRight");
    expect(calls.focusOnly).not.toHaveBeenCalled();
  });
});
