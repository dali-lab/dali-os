import { describe, it, expect } from "vitest";
import { filterRows } from "~/hooks/useFilteredList";

// Mirrors the staffing-submission rows: a name, a nullable email, and a list
// of domain ids the predicate filters on. `filterRows` is the pure pipeline
// the hook runs inside its useMemo; testing it directly exercises the
// load-bearing substring-match + predicate AND-ing without a React renderer.
type Row = { name: string; email: string | null; domainIds: string[] };

const rows: Row[] = [
  { name: "Ada Lovelace", email: "ada@dali.dev", domainIds: ["d1"] },
  { name: "Grace Hopper", email: "grace@dali.dev", domainIds: ["d2"] },
  { name: "Alan Turing", email: null, domainIds: ["d1", "d2"] },
];

const searchFields = (r: Row) => [r.name, r.email];

describe("filterRows", () => {
  it("returns all rows when the query is empty", () => {
    expect(filterRows(rows, "", searchFields)).toHaveLength(3);
  });

  it("matches on name, case-insensitively", () => {
    const out = filterRows(rows, "ADA", searchFields);
    expect(out.map((r) => r.name)).toEqual(["Ada Lovelace"]);
  });

  it("matches on email independently of name", () => {
    const out = filterRows(rows, "grace@dali", searchFields);
    expect(out.map((r) => r.name)).toEqual(["Grace Hopper"]);
  });

  it("trims leading/trailing whitespace from the query", () => {
    const out = filterRows(rows, "   turing  ", searchFields);
    expect(out.map((r) => r.name)).toEqual(["Alan Turing"]);
  });

  it("does not throw on a null email and only matches on name", () => {
    // Alan's email is null; a query for the name still matches, and a query
    // for another row's email does not leak onto him.
    expect(filterRows(rows, "alan", searchFields).map((r) => r.name)).toEqual([
      "Alan Turing",
    ]);
    expect(filterRows(rows, "ada@dali.dev", searchFields)).toHaveLength(1);
  });

  it("applies a domain predicate but is a no-op when the id is empty", () => {
    const domainId = "";
    const all = filterRows(rows, "", searchFields, [
      (r) => !domainId || r.domainIds.includes(domainId),
    ]);
    expect(all).toHaveLength(3);

    const d2 = "d2";
    const onlyD2 = filterRows(rows, "", searchFields, [
      (r) => !d2 || r.domainIds.includes(d2),
    ]);
    expect(onlyD2.map((r) => r.name)).toEqual(["Grace Hopper", "Alan Turing"]);
  });

  it("composes search and predicate with AND semantics", () => {
    const domainId = "d1";
    const out = filterRows(rows, "alan", searchFields, [
      (r) => !domainId || r.domainIds.includes(domainId),
    ]);
    expect(out.map((r) => r.name)).toEqual(["Alan Turing"]);

    // Grace is in no d1 domain, so the predicate excludes her even though the
    // name query would match.
    const none = filterRows(rows, "grace", searchFields, [
      (r) => !domainId || r.domainIds.includes(domainId),
    ]);
    expect(none).toHaveLength(0);
  });
});
