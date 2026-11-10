// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { DirectoryTable } from "../PartnerDirectoryTables";
import type { PartnerDirectoryRow } from "../../lib/partner-directory";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (n: number, over: Partial<PartnerDirectoryRow> = {}): PartnerDirectoryRow => ({
  kind: "org",
  id: `o${n}`,
  name: `Org ${n}`,
  email: null,
  title: null,
  website: null,
  logoUrl: null,
  type: null,
  status: "Active",
  orgNames: [],
  memberCount: 1,
  activeProjectCount: 0,
  totalProjectCount: 0,
  applicationCount: null,
  lastActivityAt: null,
  ...over,
});
const make = (count: number) => Array.from({ length: count }, (_, i) => row(i));

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

describe("DirectoryTable", () => {
  it("links org rows to the org page and person rows to the contact page", async () => {
    const data = [
      row(1, { kind: "org", id: "acme", name: "Acme" }),
      row(2, {
        kind: "person",
        id: "jo",
        name: "Jo",
        status: null,
        orgNames: ["Acme"],
        title: "CTO",
      }),
    ];
    await mount(() => createElement(DirectoryTable, { rows: data, sort, onSort: () => {}, resetKey: "a" }));
    const hrefs = [...container.querySelectorAll("tbody a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/core/partners/orgs/acme", "/core/partners/contacts/jo"]);
    // A person row shows its org affiliation and title; status stays blank.
    const personRow = rows()[1];
    expect(personRow.textContent).toContain("Acme");
    expect(personRow.textContent).toContain("CTO");
    expect(personRow.textContent).toContain("Person");
    expect(personRow.textContent).not.toContain("Active");
  });

  it("labels a typed org by its type and an individual by its kind", async () => {
    const data = [
      row(1, { name: "Acme", type: "Startup" }),
      row(2, { kind: "individual", name: "Sam Solo", email: "sam@example.com" }),
    ];
    await mount(() => createElement(DirectoryTable, { rows: data, sort, onSort: () => {}, resetKey: "a" }));
    expect(rows()[0].textContent).toContain("Startup");
    expect(rows()[1].textContent).toContain("Individual");
    expect(rows()[1].textContent).toContain("sam@example.com");
  });

  it("slices to 50 rows and Load more reveals the rest", async () => {
    const data = make(75);
    await mount(() => createElement(DirectoryTable, { rows: data, sort, onSort: () => {}, resetKey: "a" }));
    expect(rows()).toHaveLength(50);
    expect(container.textContent).toContain("Showing 50 of 75");
    await act(async () => loadMore()!.click());
    expect(rows()).toHaveLength(75);
    expect(loadMore()).toBeUndefined();
  });

  // macOS WKWebView lets the last row's stretched link spill to the bottom of the scroll box;
  // only a Load more outside that box stays clickable in the desktop app.
  it("renders Load more outside the table's scroll box", async () => {
    await mount(() => createElement(DirectoryTable, { rows: make(75), sort, onSort: () => {}, resetKey: "a" }));
    const scrollBox = container.querySelector("table")!.parentElement!;
    expect(scrollBox.className).toContain("overflow-x-auto");
    expect(scrollBox.contains(loadMore()!)).toBe(false);
  });

  it("returns to the first slice when the search or sort changes", async () => {
    function Harness() {
      const [key, setKey] = useState("name");
      return createElement(
        "div",
        null,
        createElement("button", { id: "resort", onClick: () => setKey("activity") }, "resort"),
        createElement(DirectoryTable, { rows: make(120), sort, onSort: () => {}, resetKey: key }),
      );
    }
    await mount(Harness);
    await act(async () => loadMore()!.click());
    expect(rows()).toHaveLength(100);
    await act(async () => (container.querySelector("#resort") as HTMLButtonElement).click());
    expect(rows()).toHaveLength(50);
  });
});
