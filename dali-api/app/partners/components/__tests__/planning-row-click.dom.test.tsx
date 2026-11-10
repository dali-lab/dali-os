// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { ProjectPlanningTable } from "../ProjectPlanningTable";
import { DomainBreakdown } from "../planning/DomainBreakdown";
import type { PlanningBreakdownRow, PlanningProjectRow } from "../../lib/planning-gap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(el: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, null, el)));
}

const clickRow = (name: string) =>
  act(async () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((b) => b.textContent?.includes(name))!
      .click(),
  );

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const base = { source: "new" as const, state: "Deciding" as const, spotsByDomain: { eng: 1 }, counted: true };

describe("planning rows open the popup for their kind", () => {
  it("passes the row kind and id from the project table", async () => {
    const onRowClick = vi.fn();
    const rows: PlanningProjectRow[] = [
      { ...base, key: "project:p1", kind: "project", refId: "p1", name: "Atlas", spots: 1, domains: [] },
      { ...base, key: "application:a1", kind: "application", refId: "a1", name: "Beacon", spots: 1, domains: [] },
    ];
    await mount(
      createElement(ProjectPlanningTable, {
        termCode: "26S",
        model: { renewing: [], fresh: rows, totals: { renewing: 0, fresh: 2, spots: 2 } },
        onRowClick,
      }),
    );
    await clickRow("Beacon");
    await clickRow("Atlas");
    expect(onRowClick.mock.calls).toEqual([
      ["application", "a1"],
      ["project", "p1"],
    ]);
  });

  it("passes the row kind and id from a domain's breakdown", async () => {
    const onRowClick = vi.fn();
    const items: PlanningBreakdownRow[] = [
      { ...base, key: "application:a1", kind: "application", refId: "a1", name: "Beacon", count: 1 },
    ];
    await mount(createElement(DomainBreakdown, { items, onRowClick }));
    await clickRow("Beacon");
    expect(onRowClick).toHaveBeenCalledWith("application", "a1");
  });
});
