// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Layers } from "lucide-react";
import { ColumnFilters, type FilterColumn } from "../ColumnFilters";
import type { ColumnFilter, FilterCells } from "../../lib/submission-filters";
import { matchesFilters } from "../../lib/submission-filters";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const columns: FilterColumn[] = [
  { key: "domain", label: "Domain", icon: Layers },
  { key: "role", label: "Role" },
];

const rows: { cells: FilterCells }[] = [
  { cells: { domain: ["Design"], role: "Developer" } },
  { cells: { domain: ["Design", "Engineering"], role: "Designer" } },
  { cells: { domain: ["Engineering"], role: "Developer" } },
];

function Harness({ initial = [] }: { initial?: ColumnFilter[] }) {
  const [filters, setFilters] = useState<ColumnFilter[]>(initial);
  const shown = rows.filter((r) => matchesFilters(r.cells, filters));
  return createElement(ColumnFilters, {
    columns,
    rows,
    filters,
    onChange: setFilters,
    shownCount: shown.length,
    noun: ["member", "members"],
  });
}

async function mount(initial?: ColumnFilter[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness, { initial }));
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const all = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const byText = (sel: string, text: string) =>
  all(sel).find((el) => el.textContent?.trim().startsWith(text)) ?? null;

describe("ColumnFilters", () => {
  it("opens the field menu, then the value picker, and applies a value", async () => {
    await mount();
    await click(q("button[aria-haspopup='menu']"));
    expect(q("[role='menu']")).not.toBeNull();

    await click(byText("[role='menuitem']", "Domain"));
    expect(q("[role='listbox']")).not.toBeNull();

    await click(byText("[role='option']", "Design"));
    expect(container.textContent).toContain("2 of 3 members");
    // The pill names the column and the value, with no operator between them.
    const pill = q("button[aria-label='Domain: Design. Edit']");
    expect(pill).not.toBeNull();
    expect(container.textContent).not.toContain(" is ");
  });

  it("shows per-option counts honoring the other columns' filters", async () => {
    await mount([{ columnKey: "role", values: ["Developer"] }]);
    await click(q("button[aria-haspopup='listbox']"));
    const design = byText("[role='option']", "Design");
    const engineering = byText("[role='option']", "Engineering");
    // Role pill is open: its own filter must not constrain its counts...
    expect(q("[aria-label='Role']")).not.toBeNull();
    // ...so open Domain through the add menu instead for cross-column counts.
    await click(q("button[aria-haspopup='menu']"));
    await click(byText("[role='menuitem']", "Domain"));
    const options = all("[role='option']");
    const count = (label: string) =>
      options.find((o) => o.textContent?.includes(label))?.querySelector(".tabular-nums")
        ?.textContent;
    expect(count("Design")).toBe("1");
    expect(count("Engineering")).toBe("1");
    expect(design ?? engineering).not.toBeNull();
  });

  it("filters picker options by search", async () => {
    await mount();
    await click(q("button[aria-haspopup='menu']"));
    await click(byText("[role='menuitem']", "Domain"));
    const input = q<HTMLInputElement>("input[type='search']");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "eng");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const options = all("[role='option']").map((o) => o.textContent);
    expect(options).toHaveLength(1);
    expect(options[0]).toContain("Engineering");
  });

  it("summarizes many values and removes the column from its pill", async () => {
    await mount([{ columnKey: "domain", values: ["Design", "Engineering"] }]);
    expect(container.textContent).toContain("Design, Engineering");

    await click(q("button[aria-label='Remove Domain filter']"));
    expect(q("button[aria-haspopup='listbox']")).toBeNull();
    expect(container.textContent).toContain("3 members");
  });

  it("clears every filter at once", async () => {
    await mount([
      { columnKey: "domain", values: ["Design"] },
      { columnKey: "role", values: ["Developer"] },
    ]);
    expect(all("button[aria-haspopup='listbox']")).toHaveLength(2);
    await click(byText("button", "Clear all"));
    expect(all("button[aria-haspopup='listbox']")).toHaveLength(0);
  });

  it("lists a column's options in its given order with display labels", async () => {
    const termRows: { cells: FilterCells }[] = [
      { cells: { term: ["24F", "25W"] } },
      { cells: { term: ["26F"] } },
    ];
    const term: FilterColumn = {
      key: "term",
      label: "Term",
      order: ["26F", "25W", "24X", "24F"],
      optionLabel: (v) => (v === "26F" ? "26F (current)" : v),
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(ColumnFilters, {
          columns: [term],
          rows: termRows,
          filters: [{ columnKey: "term", values: ["26F"] }],
          onChange: () => {},
          shownCount: 1,
        }),
      );
    });

    expect(q("button[aria-label='Term: 26F (current). Edit']")).not.toBeNull();
    await click(q("button[aria-haspopup='listbox']"));
    const options = all("[role='option']").map((o) => o.querySelector(".truncate")?.textContent);
    expect(options).toEqual(["26F (current)", "25W", "24X", "24F"]);
  });

  it("badges the Filter button with the number of picked values", async () => {
    await mount([{ columnKey: "domain", values: ["Design", "Engineering"] }]);
    expect(q("button[aria-haspopup='menu']")!.textContent).toContain("2");
  });
});
