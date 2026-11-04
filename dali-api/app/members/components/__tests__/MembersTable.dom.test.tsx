// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { MembersTable, type MemberRow } from "~/members/components/MembersTable";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const member = (n: number): MemberRow => ({
  id: `m${n}`,
  firstName: `Ada${n}`,
  lastName: "Tester",
  email: `ada${n}@example.edu`,
  pronouns: null,
  classYear: 2020,
  gradProgram: null,
  photoUrl: null,
  isStaff: false,
  coreTitles: [],
  domainRoles: [],
  createdAt: "2020-01-01T00:00:00Z",
  onboardedAt: null,
  birthday: null,
  cells: {},
});
const many = (count: number) => Array.from({ length: count }, (_, i) => member(i));

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

const table = (props: { rows: MemberRow[]; status?: "active" | "alumni"; resetKey: string }) => () =>
  createElement(MembersTable, { status: "active", ...props });

function FilterHarness() {
  const [query, setQuery] = useState("");
  const rows = query ? many(80) : many(120);
  return createElement(
    "div",
    null,
    createElement("button", { id: "narrow", onClick: () => setQuery("ada") }, "narrow"),
    createElement(MembersTable, { rows, status: "active", resetKey: query }),
  );
}

const bodyRows = () => container.querySelectorAll("tbody tr");
const loadMore = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === "Load more") as HTMLButtonElement | undefined;

describe("MembersTable", () => {
  it("renders every row and no pager when everything fits", async () => {
    await mount(table({ rows: many(10), resetKey: "a" }));
    expect(bodyRows()).toHaveLength(10);
    expect(loadMore()).toBeUndefined();
  });

  it("slices to 50 and Load more reveals the next slice on the active tab", async () => {
    await mount(table({ rows: many(120), resetKey: "a" }));
    expect(bodyRows()).toHaveLength(50);
    expect(container.textContent).toContain("Showing 50 of 120");
    await act(async () => loadMore()!.click());
    expect(bodyRows()).toHaveLength(100);
    await act(async () => loadMore()!.click());
    expect(bodyRows()).toHaveLength(120);
    expect(loadMore()).toBeUndefined();
  });

  it("slices the alumni view the same way and shows the class column", async () => {
    await mount(table({ rows: many(60), status: "alumni", resetKey: "alumni" }));
    expect(bodyRows()).toHaveLength(50);
    expect(container.textContent).toContain("Class of 2020");
  });

  it("returns to the first slice when the filter changes", async () => {
    await mount(FilterHarness);
    await act(async () => loadMore()!.click());
    expect(bodyRows()).toHaveLength(100);
    await act(async () => (container.querySelector("#narrow") as HTMLButtonElement).click());
    expect(bodyRows()).toHaveLength(50);
    expect(container.textContent).toContain("Showing 50 of 80");
  });
});
