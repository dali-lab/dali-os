// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { ContactsTable, OrgsTable } from "../PartnerDirectoryTables";
import type { PartnerContactDirectoryRow, PartnerOrgDirectoryRow } from "../../lib/partner-directory";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const org = (n: number): PartnerOrgDirectoryRow => ({
  id: `o${n}`,
  name: `Org ${n}`,
  logoUrl: null,
  website: null,
  isIndividual: false,
  type: null,
  status: "Active",
  memberCount: 1,
  activeProjectCount: 0,
  totalProjectCount: 0,
  lastActivityAt: null,
});
const contact = (n: number): PartnerContactDirectoryRow => ({
  id: `c${n}`,
  name: `Ada ${n}`,
  email: `ada${n}@example.edu`,
  title: null,
  affiliation: null,
  orgs: [],
  applicationCount: 0,
  lastActivityAt: null,
});
const make = <T,>(count: number, f: (n: number) => T) => Array.from({ length: count }, (_, i) => f(i));

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(Component: () => ReturnType<typeof createElement>) {
  const Stub = createRoutesStub([{ path: "/", Component }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

const sort = { key: "name", dir: "asc" } as const;
const rows = () => container.querySelectorAll("tbody tr");
const loadMore = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === "Load more") as HTMLButtonElement | undefined;

describe("PartnerDirectoryTables", () => {
  it("slices organizations to 50 and Load more reveals the rest", async () => {
    const data = make(75, org);
    await mount(() => createElement(OrgsTable, { rows: data, sort, onSort: () => {}, resetKey: "a" }));
    expect(rows()).toHaveLength(50);
    expect(container.textContent).toContain("Showing 50 of 75");
    await act(async () => loadMore()!.click());
    expect(rows()).toHaveLength(75);
    expect(loadMore()).toBeUndefined();
  });

  it("slices contacts to 50 and Load more reveals the rest", async () => {
    const data = make(60, contact);
    await mount(() => createElement(ContactsTable, { rows: data, sort, onSort: () => {}, resetKey: "a" }));
    expect(rows()).toHaveLength(50);
    await act(async () => loadMore()!.click());
    expect(rows()).toHaveLength(60);
  });

  it("returns to the first slice when the search or sort changes", async () => {
    function Harness() {
      const [key, setKey] = useState("name");
      return createElement(
        "div",
        null,
        createElement("button", { id: "resort", onClick: () => setKey("activity") }, "resort"),
        createElement(OrgsTable, { rows: make(120, org), sort, onSort: () => {}, resetKey: key }),
      );
    }
    await mount(Harness);
    await act(async () => loadMore()!.click());
    expect(rows()).toHaveLength(100);
    await act(async () => (container.querySelector("#resort") as HTMLButtonElement).click());
    expect(rows()).toHaveLength(50);
  });
});
