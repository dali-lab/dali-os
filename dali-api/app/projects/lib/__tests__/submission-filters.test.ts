import { describe, it, expect } from "vitest";
import {
  applicableFilters,
  cellValues,
  clearFilterColumn,
  columnResponses,
  filterValues,
  matchesFilters,
  toggleFilterValue,
  type ColumnFilter,
} from "../submission-filters";

const rows: { cells: Record<string, string> }[] = [
  { cells: { status: "Yes", why: "Love design work" } },
  { cells: { status: "No", why: "" } },
  { cells: { status: "Yes", why: "Want to mentor" } },
  { cells: { status: "Maybe" } },
];

const run = (...filters: ColumnFilter[]) =>
  rows.filter((r) => matchesFilters(r.cells, filters)).length;

describe("matchesFilters", () => {
  it("matches a row whose cell is any picked value (OR within a column)", () => {
    expect(run({ columnKey: "status", values: ["Yes"] })).toBe(2);
    expect(run({ columnKey: "status", values: ["Yes", "Maybe"] })).toBe(3);
    expect(run({ columnKey: "status", values: ["Nope"] })).toBe(0);
  });

  it("ANDs filters across columns", () => {
    expect(
      run(
        { columnKey: "status", values: ["Yes"] },
        { columnKey: "why", values: ["Want to mentor"] },
      ),
    ).toBe(1);
  });

  it("never matches an empty or missing cell", () => {
    expect(run({ columnKey: "why", values: ["Love design work"] })).toBe(1);
    expect(run({ columnKey: "gone", values: ["x"] })).toBe(0);
  });

  it("matches a list cell on any one of its entries", () => {
    const people = [
      { cells: { domain: ["Design", "Engineering"] } },
      { cells: { domain: ["Engineering"] } },
      { cells: { domain: [] } },
    ];
    const count = (values: string[]) =>
      people.filter((p) => matchesFilters(p.cells, [{ columnKey: "domain", values }])).length;
    expect(count(["Design"])).toBe(1);
    expect(count(["Design", "Engineering"])).toBe(2);
  });
});

describe("applicableFilters", () => {
  it("skips filters with no values yet or a column the board no longer has", () => {
    const filters: ColumnFilter[] = [
      { columnKey: "status", values: [] },
      { columnKey: "gone", values: ["x"] },
      { columnKey: "why", values: ["Want to mentor"] },
    ];
    expect(applicableFilters(filters, ["status", "why"])).toEqual([
      { columnKey: "why", values: ["Want to mentor"] },
    ]);
  });
});

describe("toggleFilterValue", () => {
  it("starts a column's filter on the first value", () => {
    expect(toggleFilterValue([], "status", "Yes")).toEqual([
      { columnKey: "status", values: ["Yes"] },
    ]);
  });

  it("adds and removes values on an existing column in place", () => {
    const one: ColumnFilter[] = [{ columnKey: "status", values: ["Yes"] }];
    const two = toggleFilterValue(one, "status", "No");
    expect(two).toEqual([{ columnKey: "status", values: ["Yes", "No"] }]);
    expect(toggleFilterValue(two, "status", "Yes")).toEqual([
      { columnKey: "status", values: ["No"] },
    ]);
  });

  it("drops a column whose last value is removed, keeping the others", () => {
    const filters: ColumnFilter[] = [
      { columnKey: "status", values: ["Yes"] },
      { columnKey: "why", values: ["Want to mentor"] },
    ];
    expect(toggleFilterValue(filters, "status", "Yes")).toEqual([
      { columnKey: "why", values: ["Want to mentor"] },
    ]);
  });
});

describe("filterValues / clearFilterColumn", () => {
  const filters: ColumnFilter[] = [
    { columnKey: "status", values: ["Yes", "No"] },
    { columnKey: "why", values: ["Want to mentor"] },
  ];

  it("reads one column's picked values, empty when unfiltered", () => {
    expect(filterValues(filters, "status")).toEqual(["Yes", "No"]);
    expect(filterValues(filters, "gone")).toEqual([]);
  });

  it("removes one column's filter entirely", () => {
    expect(clearFilterColumn(filters, "status")).toEqual([
      { columnKey: "why", values: ["Want to mentor"] },
    ]);
  });
});

describe("cellValues", () => {
  it("normalizes missing, string and list cells, trimming blanks", () => {
    expect(cellValues(undefined)).toEqual([]);
    expect(cellValues("  ")).toEqual([]);
    expect(cellValues("Yes")).toEqual(["Yes"]);
    expect(cellValues([" Design ", "", "Engineering"])).toEqual(["Design", "Engineering"]);
  });
});

describe("columnResponses", () => {
  it("lists a column's distinct non-empty responses, sorted", () => {
    expect(columnResponses(rows, "status")).toEqual(["Maybe", "No", "Yes"]);
    expect(columnResponses(rows, "why")).toEqual(["Love design work", "Want to mentor"]);
  });

  it("flattens and dedupes list cells, sorting numerically", () => {
    const people = [
      { cells: { year: ["2024", "2026"] } },
      { cells: { year: ["2024", "2028"] } },
    ];
    expect(columnResponses(people, "year")).toEqual(["2024", "2026", "2028"]);
  });

  it("follows a given order instead of sorting, so terms aren't lexical", () => {
    const projects = [{ cells: { term: ["24F", "25W"] } }, { cells: { term: ["25S"] } }];
    expect(columnResponses(projects, "term", ["25S", "25W", "24F"])).toEqual([
      "25S",
      "25W",
      "24F",
    ]);
  });

  it("lists every ordered value even when no row has it", () => {
    const projects = [{ cells: { term: "25W" } }];
    expect(columnResponses(projects, "term", ["26F", "25W"])).toEqual(["26F", "25W"]);
  });

  it("puts responses missing from the order after it, sorted", () => {
    const projects = [{ cells: { term: ["25W", "Zeta", "Alpha"] } }];
    expect(columnResponses(projects, "term", ["25W"])).toEqual(["25W", "Alpha", "Zeta"]);
  });
});
