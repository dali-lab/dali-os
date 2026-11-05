// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useInsertItems } from "../useInsertItems";
import type { InsertItem } from "../InsertMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let insertItem: (item: InsertItem, at?: { x: number; y: number }) => void;
const insert = { text: vi.fn(), shape: vi.fn(), table: vi.fn(), code: vi.fn(), chart: vi.fn(), icon: vi.fn(), emoji: vi.fn(), video: vi.fn() };
const arm = vi.fn();
const pickImage = vi.fn();

function Probe() {
  insertItem = useInsertItems({ insert: insert as never, arm, pickImage }).insertItem;
  return null;
}
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  vi.clearAllMocks();
  act(() => root.render(createElement(Probe)));
});
afterEach(() => act(() => root.unmount()));

describe("insert at a point", () => {
  it("places text, shapes and images at the point instead of arming the tool", () => {
    act(() => insertItem({ type: "text" }, { x: 5, y: 6 }));
    act(() => insertItem({ type: "shape", shape: "ellipse" }, { x: 5, y: 6 }));
    act(() => insertItem({ type: "image" }, { x: 5, y: 6 }));
    expect(insert.text).toHaveBeenCalledWith({ x: 5, y: 6 });
    expect(insert.shape).toHaveBeenCalledWith("ellipse", { x: 5, y: 6 });
    expect(pickImage).toHaveBeenCalledWith({ x: 5, y: 6 });
    expect(arm).not.toHaveBeenCalled();
  });

  it("keeps the toolbar behavior without a point", () => {
    act(() => insertItem({ type: "text" }));
    act(() => insertItem({ type: "image" }));
    expect(arm).toHaveBeenCalledWith({ type: "text" });
    expect(pickImage).toHaveBeenCalledWith();
  });

  it("passes the point to table, code and chart", () => {
    act(() => insertItem({ type: "table" }, { x: 1, y: 2 }));
    act(() => insertItem({ type: "chart", chart: "pie" }, { x: 1, y: 2 }));
    expect(insert.table).toHaveBeenCalledWith({ x: 1, y: 2 });
    expect(insert.chart).toHaveBeenCalledWith("pie", { x: 1, y: 2 });
  });
});
