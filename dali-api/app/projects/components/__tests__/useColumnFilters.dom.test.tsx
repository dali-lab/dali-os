// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { useColumnFilters } from "../ColumnFilters";
import type { ColumnFilter } from "../../lib/submission-filters";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLUMNS = [{ key: "domain" }, { key: "term" }];
const CURRENT_TERM: ColumnFilter[] = [{ columnKey: "term", values: ["26F"] }];

let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
let current: ReturnType<typeof useColumnFilters>;

function Probe({ initial, inUrl }: { initial: ColumnFilter[]; inUrl: boolean }) {
  current = useColumnFilters(COLUMNS, initial, { inUrl });
  return null;
}

async function mount(entry: string, initial: ColumnFilter[] = [], inUrl = true) {
  router = createMemoryRouter(
    [{ path: "/list", Component: () => createElement(Probe, { initial, inUrl }) }],
    { initialEntries: [entry] },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(RouterProvider, { router })));
}

const set = (next: ColumnFilter[]) => act(async () => current.setFilters(next));
const search = () => decodeURIComponent(router.state.location.search);

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useColumnFilters with inUrl", () => {
  it("reads the filters from the URL", async () => {
    await mount("/list?f.domain=Design&f.domain=Eng");
    expect(current.filters).toEqual([{ columnKey: "domain", values: ["Design", "Eng"] }]);
  });

  it("uses the defaults while the URL says nothing about filters", async () => {
    await mount("/list?q=ada", CURRENT_TERM);
    expect(current.filters).toEqual(CURRENT_TERM);
  });

  it("lets URL filters win over the defaults", async () => {
    await mount("/list?f.domain=Design", CURRENT_TERM);
    expect(current.filters).toEqual([{ columnKey: "domain", values: ["Design"] }]);
  });

  it("writes picked filters to the URL, keeps other params, and replaces history", async () => {
    await mount("/list?q=ada");
    await set([{ columnKey: "domain", values: ["Design"] }]);
    expect(search()).toBe("?q=ada&f.domain=Design");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(current.active).toEqual([{ columnKey: "domain", values: ["Design"] }]);
  });

  it("records an emptied board so the defaults don't come back", async () => {
    await mount("/list", CURRENT_TERM);
    await set([]);
    expect(search()).toBe("?f=");
    expect(current.filters).toEqual([]);
  });

  it("drops every filter param when cleared on a board without defaults", async () => {
    await mount("/list?q=ada&f.domain=Design");
    await set([]);
    expect(search()).toBe("?q=ada");
    expect(current.filters).toEqual([]);
  });

  it("follows the URL on back", async () => {
    await mount("/list");
    await act(async () => router.navigate("/list?f.domain=Eng"));
    await act(async () => router.navigate("/list?f.domain=Design"));
    await act(async () => router.navigate(-1));
    expect(current.filters).toEqual([{ columnKey: "domain", values: ["Eng"] }]);
  });

  it("ignores filters on columns the board doesn't have", async () => {
    await mount("/list?f.gone=x&f.domain=Design");
    expect(current.active).toEqual([{ columnKey: "domain", values: ["Design"] }]);
  });
});

describe("useColumnFilters without inUrl", () => {
  it("keeps filters in memory and leaves the URL alone", async () => {
    await mount("/list?f.domain=Eng", CURRENT_TERM, false);
    expect(current.filters).toEqual(CURRENT_TERM);
    await set([{ columnKey: "domain", values: ["Design"] }]);
    expect(current.filters).toEqual([{ columnKey: "domain", values: ["Design"] }]);
    expect(search()).toBe("?f.domain=Eng");
  });
});
