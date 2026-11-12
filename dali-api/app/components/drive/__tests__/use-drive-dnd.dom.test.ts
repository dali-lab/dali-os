// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type DragEvent } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { useDriveDnd, type DriveDndOptions } from "~/components/drive/use-drive-dnd";
import type { DriveItem } from "~/drive/lib/drive.server";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { renderHook } from "./render-hook";

const at = new Date("2026-01-01T00:00:00Z");
const item = (type: DriveItem["type"], id: string, parentFolderId: string | null = null): DriveItem =>
  ({ type, id, title: id, parentFolderId, iconEmoji: null, updatedAt: at, href: `/x/${id}` }) as DriveItem;
const lab: DriveTreeScope = {
  id: "lab",
  label: "Lab",
  iconEmoji: null,
  items: [item("folder", "f1"), item("folder", "f2", "f1"), item("doc", "d1"), item("doc", "d2"), item("doc", "d3", "f1"), item("notebook" as DriveItem["type"], "nb")],
};
const mine: DriveTreeScope = { id: "mine", label: "Mine", iconEmoji: null, items: [] };
const byId = (id: string) => lab.items.find((i) => i.id === id)!;

function setup(over: Partial<DriveDndOptions> = {}) {
  const calls = {
    suppressNextClick: vi.fn(),
    dropOnNotebook: vi.fn(),
    onMove: vi.fn(),
    onMoveToScope: vi.fn(),
    onUploadFiles: vi.fn(),
  };
  const options: DriveDndOptions = {
    scopes: [lab, mine],
    currentScope: lab,
    searching: false,
    hits: [],
    selected: new Set(),
    selectedItems: [],
    ...calls,
    ...over,
  };
  const hook = renderHook(useDriveDnd, { initialProps: options });
  mounted.push(hook.unmount);
  return { calls, result: hook.result };
}
const mounted: Array<() => void> = [];
afterEach(() => mounted.splice(0).forEach((u) => u()));

const start = (src: unknown) => ({ active: { data: { current: src } } }) as unknown as DragStartEvent;
const end = (src: unknown, dest: unknown) =>
  ({ active: { data: { current: src } }, over: dest ? { data: { current: dest } } : null }) as unknown as DragEndEvent;

describe("useDriveDnd: row drags", () => {
  it("tracks the active drag from start to end and swallows the click that ends it", () => {
    const { calls, result } = setup();
    act(() => result.current.handleDragStart(start({ item: byId("d1"), scopeId: "lab" })));
    expect(result.current.activeDrag?.item.id).toBe("d1");
    act(() => result.current.handleDragEnd(end({ item: byId("d1"), scopeId: "lab" }, null)));
    expect(result.current.activeDrag).toBeNull();
    expect(calls.suppressNextClick).toHaveBeenCalled();
    expect(calls.onMove).not.toHaveBeenCalled();
  });

  it("moves a row dropped on a folder of the same drive", () => {
    const { calls, result } = setup();
    act(() => result.current.handleDragEnd(end({ item: byId("d1"), scopeId: "lab" }, { destFolderId: "f1", destScopeId: "lab" })));
    expect(calls.onMove).toHaveBeenCalledWith("lab", [byId("d1")], "f1");
  });

  it("takes the destination drive from the drop target, not the browsed one", () => {
    const { calls, result } = setup({ currentScope: mine });
    act(() => result.current.handleDragEnd(end({ item: byId("d1"), scopeId: "lab" }, { destFolderId: "f1", destScopeId: "lab" })));
    expect(calls.onMove).toHaveBeenCalledWith("lab", [byId("d1")], "f1");
  });

  it("drops what cannot go: a folder into itself or its subtree, and a row already there", () => {
    const { calls, result } = setup();
    act(() => result.current.handleDragEnd(end({ item: byId("f1"), scopeId: "lab" }, { destFolderId: "f1", destScopeId: "lab" })));
    act(() => result.current.handleDragEnd(end({ item: byId("f1"), scopeId: "lab" }, { destFolderId: "f2", destScopeId: "lab" })));
    act(() => result.current.handleDragEnd(end({ item: byId("d3"), scopeId: "lab" }, { destFolderId: "f1", destScopeId: "lab" })));
    expect(calls.onMove).not.toHaveBeenCalled();
  });

  it("moves to the drive's top level when the destination folder is null", () => {
    const { calls, result } = setup();
    act(() => result.current.handleDragEnd(end({ item: byId("d3"), scopeId: "lab" }, { destFolderId: null, destScopeId: "lab" })));
    expect(calls.onMove).toHaveBeenCalledWith("lab", [byId("d3")], null);
  });

  it("hands a drop on another drive's row to the cross-drive move, and ignores one on its own drive's row", () => {
    const { calls, result } = setup();
    act(() => result.current.handleDragEnd(end({ item: byId("d1"), scopeId: "lab" }, { destScopeId: "mine" })));
    expect(calls.onMoveToScope).toHaveBeenCalledWith("lab", "mine", [byId("d1")]);
    act(() => result.current.handleDragEnd(end({ item: byId("d1"), scopeId: "lab" }, { destScopeId: "lab" })));
    expect(calls.onMoveToScope).toHaveBeenCalledTimes(1);
    expect(calls.onMove).not.toHaveBeenCalled();
  });

  it("treats a folder drop in another drive as a cross-drive move", () => {
    const { calls, result } = setup();
    act(() => result.current.handleDragEnd(end({ item: byId("d1"), scopeId: "lab" }, { destFolderId: "x", destScopeId: "mine" })));
    expect(calls.onMoveToScope).toHaveBeenCalledWith("lab", "mine", [byId("d1")]);
  });

  it("drops a row onto a notebook, but never a notebook onto itself", () => {
    const { calls, result } = setup();
    act(() => result.current.handleDragEnd(end({ item: byId("d1"), scopeId: "lab" }, { destNotebookId: "nb" })));
    expect(calls.dropOnNotebook).toHaveBeenCalledWith(byId("nb"), [byId("d1")]);
    act(() => result.current.handleDragEnd(end({ item: byId("nb"), scopeId: "lab" }, { destNotebookId: "nb" })));
    expect(calls.dropOnNotebook).toHaveBeenCalledTimes(1);
  });

  it("drags the whole selection when the dragged row is part of it", () => {
    const sel = [byId("d1"), byId("d2")];
    const { calls, result } = setup({ selected: new Set(["d1", "d2"]), selectedItems: sel });
    act(() => result.current.handleDragEnd(end({ item: byId("d1"), scopeId: "lab" }, { destFolderId: "f1", destScopeId: "lab" })));
    expect(calls.onMove).toHaveBeenCalledWith("lab", sel, "f1");
  });

  it("drags only the row under the cursor when it is outside the selection", () => {
    const { result } = setup({ selected: new Set(["d2", "d3"]), selectedItems: [byId("d2"), byId("d3")] });
    expect(result.current.draggedItemsFor({ item: byId("d1"), scopeId: "lab" })).toEqual([byId("d1")]);
  });

  it("brings only the selected search hits of the dragged row's drive", () => {
    const hits = [
      { item: byId("d1"), scope: lab },
      { item: byId("d2"), scope: lab },
      { item: item("doc", "m1"), scope: mine },
    ];
    const { result } = setup({
      searching: true,
      hits,
      selected: new Set(["d1", "d2", "m1"]),
      selectedItems: hits.map((h) => h.item),
    });
    expect(result.current.draggedItemsFor({ item: byId("d1"), scopeId: "lab" }).map((i) => i.id)).toEqual(["d1", "d2"]);
    expect(result.current.draggedItemsFor({ item: item("doc", "m1"), scopeId: "mine" }).map((i) => i.id)).toEqual(["m1"]);
  });
});

function fileDrag(target: Element = document.createElement("div"), files: File[] = [new File(["x"], "a.txt")]) {
  const dataTransfer = { types: ["Files"], files, items: [], dropEffect: "none" };
  return { target, dataTransfer, preventDefault: vi.fn() } as unknown as DragEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("useDriveDnd: drag-to-upload", () => {
  it("lights the pane while a file is over it, and clears once every enter has left", () => {
    const { result } = setup();
    act(() => result.current.onFileDragEnter(fileDrag()));
    act(() => result.current.onFileDragEnter(fileDrag()));
    expect(result.current.uploadOver).toBe(true);
    act(() => result.current.onFileDragLeave(fileDrag()));
    expect(result.current.uploadOver).toBe(true);
    act(() => result.current.onFileDragLeave(fileDrag()));
    expect(result.current.uploadOver).toBe(false);
  });

  it("names the folder row a file hovers", () => {
    const row = document.createElement("div");
    row.setAttribute("data-file-drop-folder", "f1");
    const child = document.createElement("span");
    row.appendChild(child);
    const { result } = setup();
    act(() => result.current.onFileDragOver(fileDrag(child)));
    expect(result.current.fileOverFolder).toBe("f1");
  });

  it("uploads dropped files into the hovered folder, or with no options at the top", () => {
    const row = document.createElement("div");
    row.setAttribute("data-file-drop-folder", "f1");
    const { calls, result } = setup();
    const files = [new File(["x"], "a.txt")];
    act(() => result.current.onFileDrop(fileDrag(row, files)));
    expect(calls.onUploadFiles).toHaveBeenLastCalledWith(files, { folderId: "f1" });
    act(() => result.current.onFileDrop(fileDrag(document.createElement("div"), files)));
    expect(calls.onUploadFiles).toHaveBeenLastCalledWith(files);
    expect(result.current.uploadOver).toBe(false);
  });

  it("ignores file drags while searching, without a drive, or without an upload handler", () => {
    for (const over of [{ searching: true }, { currentScope: null }, { onUploadFiles: undefined }] as Partial<DriveDndOptions>[]) {
      const { calls, result } = setup(over);
      const e = fileDrag();
      act(() => result.current.onFileDragEnter(e));
      act(() => result.current.onFileDrop(e));
      expect(result.current.uploadOver).toBe(false);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(calls.onUploadFiles).not.toHaveBeenCalled();
    }
  });

  it("ignores drags that carry no files", () => {
    const { result } = setup();
    const e = fileDrag();
    (e.dataTransfer as unknown as { types: string[] }).types = ["text/plain"];
    act(() => result.current.onFileDragEnter(e));
    expect(result.current.uploadOver).toBe(false);
  });
});
