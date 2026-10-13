// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NOTEBOOK_RAIL_COLLAPSED_KEY, useRailCollapsed } from "~/components/notebooks/use-rail-collapsed";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let current: ReturnType<typeof useRailCollapsed>;

function Probe() {
  current = useRailCollapsed();
  return null;
}

async function mount() {
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(createElement(Probe)));
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
});

describe("useRailCollapsed", () => {
  it("starts expanded with nothing stored", async () => {
    await mount();
    expect(current.collapsed).toBe(false);
  });

  it("reads 1 as collapsed", async () => {
    window.localStorage.setItem(NOTEBOOK_RAIL_COLLAPSED_KEY, "1");
    await mount();
    expect(current.collapsed).toBe(true);
  });

  it("writes 1 when collapsing and removes the key when expanding", async () => {
    await mount();
    await act(async () => current.setCollapsed(true));
    expect(window.localStorage.getItem("dali:notebook-rail:collapsed")).toBe("1");
    await act(async () => current.setCollapsed(false));
    expect(window.localStorage.getItem(NOTEBOOK_RAIL_COLLAPSED_KEY)).toBeNull();
    expect(current.collapsed).toBe(false);
  });

  it("still toggles when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await mount();
    expect(current.collapsed).toBe(false);
    await act(async () => current.setCollapsed(true));
    expect(current.collapsed).toBe(true);
  });
});
