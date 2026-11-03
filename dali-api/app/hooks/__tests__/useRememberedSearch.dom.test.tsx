// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useSearchParams } from "react-router";
import { useRememberedSearch } from "../useRememberedSearch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "test:list:view";
let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
let setParams: ReturnType<typeof useSearchParams>[1];

function Probe() {
  useRememberedSearch(KEY, { transient: ["application"] });
  setParams = useSearchParams()[1];
  return null;
}

async function mount(entry: string) {
  router = createMemoryRouter([{ path: "/list", Component: Probe }], { initialEntries: [entry] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(RouterProvider, { router })));
  await act(async () => {});
}

const search = () => router.state.location.search;

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("useRememberedSearch", () => {
  it("remembers the view", async () => {
    await mount("/list?cycle=c1&status=Submitted");
    expect(window.localStorage.getItem(KEY)).toBe("cycle=c1&status=Submitted");
  });

  it("remembers each change", async () => {
    await mount("/list?cycle=c1");
    await act(async () => setParams({ cycle: "c2" }));
    expect(window.localStorage.getItem(KEY)).toBe("cycle=c2");
  });

  it("reopens the last view on a bare visit, replacing history", async () => {
    window.localStorage.setItem(KEY, "cycle=c1&q=ada");
    await mount("/list");
    expect(search()).toBe("?cycle=c1&q=ada");
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("keeps a link's own view instead of the remembered one", async () => {
    window.localStorage.setItem(KEY, "cycle=c1");
    await mount("/list?cycle=c2");
    expect(search()).toBe("?cycle=c2");
    expect(window.localStorage.getItem(KEY)).toBe("cycle=c2");
  });

  it("treats a visit with only the shell's embed param as bare, and keeps embed", async () => {
    window.localStorage.setItem(KEY, "cycle=c1");
    await mount("/list?embed=1");
    expect(new URLSearchParams(search()).get("cycle")).toBe("c1");
    expect(new URLSearchParams(search()).get("embed")).toBe("1");
    expect(window.localStorage.getItem(KEY)).toBe("cycle=c1");
  });

  it("forgets the view once everything is cleared", async () => {
    await mount("/list?status=Submitted");
    await act(async () => setParams({}));
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("doesn't remember transient params", async () => {
    await mount("/list?sort=fee&application=a1");
    expect(window.localStorage.getItem(KEY)).toBe("sort=fee");
  });

  it("treats a visit with only transient params as bare, and keeps them", async () => {
    window.localStorage.setItem(KEY, "sort=fee");
    await mount("/list?application=a1");
    const params = new URLSearchParams(search());
    expect(params.get("sort")).toBe("fee");
    expect(params.get("application")).toBe("a1");
  });

  it("opens bare when storage can't be read", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await mount("/list");
    expect(search()).toBe("");
  });
});
