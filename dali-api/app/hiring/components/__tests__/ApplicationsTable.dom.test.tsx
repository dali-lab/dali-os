// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { ApplicationsTable, type ApplicationTableRow } from "../ApplicationsTable";
import { applicationColumns, DEFAULT_SORT } from "~/hiring/lib/application-filters";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (n: number): ApplicationTableRow => ({
  id: `a${n}`,
  name: `Ada ${n}`,
  domain: "Web",
  status: "Submitted",
  submittedAt: "2026-10-01T12:00:00Z",
  lateBy: null,
  reviewers: null,
  interviewers: null,
});
const many = (count: number) => Array.from({ length: count }, (_, i) => row(i));
const columns = applicationColumns("Open");

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(Component: () => ReturnType<typeof createElement>) {
  const Stub = createRoutesStub([
    { path: "/", Component },
    { path: "/hiring/applications/:id", Component: () => createElement("p", { id: "detail" }, "detail") },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

const table = (rows: ApplicationTableRow[], resetKey = "a") => () =>
  createElement(ApplicationsTable, { rows, columns, activeSort: DEFAULT_SORT, onSort: () => {}, resetKey });
const bodyRows = () => container.querySelectorAll("tbody tr");
const loadMore = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === "Load more") as HTMLButtonElement | undefined;

describe("ApplicationsTable", () => {
  it("slices to 50 rows and Load more reveals the rest", async () => {
    await mount(table(many(130)));
    expect(bodyRows()).toHaveLength(50);
    expect(container.textContent).toContain("Showing 50 of 130");
    await act(async () => loadMore()!.click());
    await act(async () => loadMore()!.click());
    expect(bodyRows()).toHaveLength(130);
    expect(loadMore()).toBeUndefined();
  });

  it("returns to the first slice when the filters change", async () => {
    function Harness() {
      const [stage, setStage] = useState("all");
      return createElement(
        "div",
        null,
        createElement("button", { id: "filter", onClick: () => setStage("Submitted") }, "filter"),
        createElement(ApplicationsTable, {
          rows: many(stage === "all" ? 120 : 70),
          columns,
          activeSort: DEFAULT_SORT,
          onSort: () => {},
          resetKey: stage,
        }),
      );
    }
    await mount(Harness);
    await act(async () => loadMore()!.click());
    expect(bodyRows()).toHaveLength(100);
    await act(async () => (container.querySelector("#filter") as HTMLButtonElement).click());
    expect(bodyRows()).toHaveLength(50);
  });

  it("still opens an application from a row and sorts from the headers", async () => {
    const sorts: unknown[] = [];
    await mount(() =>
      createElement(ApplicationsTable, {
        rows: many(3),
        columns,
        activeSort: DEFAULT_SORT,
        onSort: (s) => sorts.push(s),
        resetKey: "a",
      }),
    );
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Sort by Domain, descending"]')!.click());
    expect(sorts).toEqual([{ key: "domain", dir: "desc" }]);
    await act(async () => bodyRows()[1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelector("#detail")).not.toBeNull();
  });
});
