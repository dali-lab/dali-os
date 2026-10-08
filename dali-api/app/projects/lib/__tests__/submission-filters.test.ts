import { describe, it, expect } from "vitest";
import {
  applicableFilters,
  columnResponses,
  matchesFilters,
  type ColumnFilter,
} from "../submission-filters";

const rows: { cells: Record<string, string> }[] = [
  { cells: { status: "Yes", why: "Love design work" } },
  { cells: { status: "No", why: "" } },
  { cells: { status: "Yes", why: "Want to mentor" } },
  { cells: { status: "Maybe" } },
];

const f = (over: Partial<ColumnFilter>): ColumnFilter => ({
  id: "1",
  columnKey: "status",
  operator: "is",
  value: "",
  ...over,
});

const run = (...filters: ColumnFilter[]) =>
  rows.filter((r) => matchesFilters(r.cells, filters)).length;

describe("submission-filters", () => {
  it("matches each operator against the cell text", () => {
    expect(run(f({ operator: "is", value: "Yes" }))).toBe(2);
    expect(run(f({ operator: "isNot", value: "Yes" }))).toBe(2);
    expect(run(f({ columnKey: "why", operator: "contains", value: "DESIGN" }))).toBe(1);
    expect(run(f({ columnKey: "why", operator: "notContains", value: "design" }))).toBe(3);
    expect(run(f({ columnKey: "why", operator: "isEmpty" }))).toBe(2);
    expect(run(f({ columnKey: "why", operator: "isNotEmpty" }))).toBe(2);
  });

  it("ANDs multiple filters", () => {
    expect(
      run(
        f({ operator: "is", value: "Yes" }),
        f({ id: "2", columnKey: "why", operator: "contains", value: "mentor" }),
      ),
    ).toBe(1);
  });

  it("skips filters with no value yet or a column the board no longer has", () => {
    const filters = [
      f({ operator: "is", value: "" }),
      f({ id: "2", columnKey: "gone", operator: "is", value: "x" }),
      f({ id: "3", operator: "isEmpty" }),
      f({ id: "4", operator: "is", value: "No" }),
    ];
    expect(applicableFilters(filters, ["status", "why"]).map((x) => x.id)).toEqual(["3", "4"]);
  });

  it("matches a list cell on any one of its entries", () => {
    const people = [
      { cells: { domain: ["Design", "Engineering"] } },
      { cells: { domain: ["Engineering"] } },
      { cells: { domain: [] } },
    ];
    const count = (operator: ColumnFilter["operator"], value = "") =>
      people.filter((p) =>
        matchesFilters(p.cells, [{ id: "1", columnKey: "domain", operator, value }]),
      ).length;
    expect(count("is", "Design")).toBe(1);
    expect(count("isNot", "Design")).toBe(2);
    expect(count("contains", "eng")).toBe(2);
    expect(count("isEmpty")).toBe(1);
    expect(columnResponses(people, "domain")).toEqual(["Design", "Engineering"]);
  });

  it("lists a column's distinct non-empty responses, sorted", () => {
    expect(columnResponses(rows, "status")).toEqual(["Maybe", "No", "Yes"]);
    expect(columnResponses(rows, "why")).toEqual(["Love design work", "Want to mentor"]);
  });
});
