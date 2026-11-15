// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { useDriveSelection, type DriveItemEntry } from "~/components/drive/use-drive-selection";
import type { DriveItem } from "~/drive/lib/drive.server";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { renderHook } from "./render-hook";

const at = new Date("2026-01-01T00:00:00Z");
const doc = (id: string): DriveItem => ({ type: "doc", id, title: id, parentFolderId: null, iconEmoji: null, updatedAt: at, href: `/documents/${id}` });
const index = (...ids: string[]) => new Map<string, DriveItemEntry>(ids.map((id) => [id, { item: doc(id), scopeId: "lab" }]));
const scopes: DriveTreeScope[] = [{ id: "lab", label: "Lab", iconEmoji: null, items: [] }];

type Props = Parameters<typeof useDriveSelection>[0];
const base = (over: Partial<Props> = {}): Props => ({
  itemIndex: index("a", "b", "c", "d"),
  scopes,
  scopesFocusable: false,
  listing: ["a", "b", "c", "d"].map(doc),
  currentScopeId: "lab",
  currentFolderId: null,
  followRow: () => {},
  ...over,
});

const mounted: Array<() => void> = [];
afterEach(() => mounted.splice(0).forEach((u) => u()));
function mount(over: Partial<Props> = {}) {
  const hook = renderHook(useDriveSelection, { initialProps: base(over) });
  mounted.push(hook.unmount);
  return hook;
}
const ids = (s: Set<string>) => [...s].sort();

describe("useDriveSelection", () => {
  it("focuses and selects one row, or only focuses a drive", () => {
    const { result } = mount();
    act(() => result.current.focusOnly("b"));
    expect(ids(result.current.selected)).toEqual(["b"]);
    expect(result.current.anchorId).toBe("b");
    expect(result.current.focusId).toBe("b");
    act(() => result.current.focusOnly("lab", false));
    expect(result.current.selected.size).toBe(0);
    expect(result.current.anchorId).toBeNull();
    expect(result.current.focusId).toBe("lab");
  });

  it("toggles a row with cmd-click and moves the anchor to it", () => {
    const { result } = mount();
    act(() => result.current.focusOnly("a"));
    act(() => result.current.selectWithModifier("c", "toggle", ["a", "b", "c", "d"]));
    expect(ids(result.current.selected)).toEqual(["a", "c"]);
    expect(result.current.anchorId).toBe("c");
    act(() => result.current.selectWithModifier("a", "toggle", ["a", "b", "c", "d"]));
    expect(ids(result.current.selected)).toEqual(["c"]);
  });

  it("extends a shift-click range inside one pool, in either direction, keeping the anchor", () => {
    const { result } = mount();
    act(() => result.current.focusOnly("b"));
    act(() => result.current.selectWithModifier("d", "range", ["a", "b", "c", "d"]));
    expect(ids(result.current.selected)).toEqual(["b", "c", "d"]);
    expect(result.current.anchorId).toBe("b");
    act(() => result.current.selectWithModifier("a", "range", ["a", "b", "c", "d"]));
    expect(ids(result.current.selected)).toEqual(["a", "b"]);
    expect(result.current.focusId).toBe("a");
  });

  it("tells the host which row took focus", () => {
    const followRow = vi.fn();
    const { result } = mount({ followRow });
    act(() => result.current.selectWithModifier("c", "toggle", ["a", "c"]));
    expect(followRow).toHaveBeenLastCalledWith("c");
  });

  it("selects a right-clicked row alone unless it is already selected", () => {
    const { result } = mount();
    act(() => result.current.selectIds(["a", "b"]));
    act(() => result.current.handleContextSelect("b"));
    expect(ids(result.current.selected)).toEqual(["a", "b"]);
    expect(result.current.focusId).toBe("b");
    act(() => result.current.handleContextSelect("d"));
    expect(ids(result.current.selected)).toEqual(["d"]);
    expect(result.current.anchorId).toBe("d");
  });

  it("selects a marquee's rows, anchoring on the first and focusing the last", () => {
    const { result } = mount();
    act(() => result.current.selectIds(["b", "c", "d"]));
    expect(result.current.anchorId).toBe("b");
    expect(result.current.focusId).toBe("d");
    expect(result.current.selectedItems.map((i) => i.id)).toEqual(["b", "c", "d"]);
    act(() => result.current.selectIds([]));
    expect(result.current.focusId).toBeNull();
  });

  it("clears selection, anchor and focus", () => {
    const { result } = mount();
    act(() => result.current.focusOnly("a"));
    act(() => result.current.clearSelection());
    expect(result.current.selected.size).toBe(0);
    expect(result.current.anchorId).toBeNull();
    expect(result.current.focusId).toBeNull();
  });

  it("drops what the view stops showing, and keeps what it still shows", () => {
    const { result, rerender } = mount();
    act(() => result.current.selectIds(["a", "b", "c"]));
    rerender(base({ itemIndex: index("b", "c", "d") }));
    expect(ids(result.current.selected)).toEqual(["b", "c"]);
    expect(result.current.anchorId).toBeNull();
    expect(result.current.focusId).toBe("c");
  });

  it("keeps focus on a drive only while drives are focusable", () => {
    const { result, rerender } = mount({ scopesFocusable: true });
    act(() => result.current.focusOnly("lab", false));
    rerender(base({ scopesFocusable: true, itemIndex: index("a") }));
    expect(result.current.focusId).toBe("lab");
    rerender(base({ scopesFocusable: false, itemIndex: index("a", "b") }));
    expect(result.current.focusId).toBeNull();
  });

  it("keeps only rows of the new folder's listing when the location changes", () => {
    const { result, rerender } = mount();
    act(() => result.current.selectIds(["a", "b"]));
    rerender(base({ currentFolderId: "f1", listing: [doc("b")] }));
    expect(ids(result.current.selected)).toEqual(["b"]);
    expect(result.current.anchorId).toBeNull();
  });

  it("selects the initial item once, never again", () => {
    const followRow = vi.fn();
    const { result, rerender } = mount({ initialSelectedId: "c", followRow });
    expect(ids(result.current.selected)).toEqual(["c"]);
    expect(followRow).toHaveBeenCalledWith("c");
    act(() => result.current.clearSelection());
    rerender(base({ initialSelectedId: "c", followRow, itemIndex: index("a", "b", "c") }));
    expect(result.current.selected.size).toBe(0);
  });

  it("reveals an id once it is on screen, and each new id once", () => {
    const { result, rerender } = mount({ revealId: "z" });
    expect(result.current.selected.size).toBe(0);
    rerender(base({ revealId: "z", itemIndex: index("a", "z") }));
    expect(ids(result.current.selected)).toEqual(["z"]);
    act(() => result.current.clearSelection());
    rerender(base({ revealId: "z", itemIndex: index("a", "z", "q") }));
    expect(result.current.selected.size).toBe(0);
    rerender(base({ revealId: "q", itemIndex: index("a", "z", "q") }));
    expect(ids(result.current.selected)).toEqual(["q"]);
  });
});
