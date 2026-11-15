import { describe, expect, it } from "vitest";
import { filterBoardRows } from "../board-filters";

const rows = [
  { userId: "u1", name: "Ada Lovelace", email: "ada@example.edu", domainIds: ["eng"], cells: { "q:a": "Yes" } },
  { userId: "u2", name: "Grace Hopper", email: null, domainIds: ["des"], cells: { "q:a": "No" } },
  { userId: "u3", name: "Alan Turing", email: "alan@example.edu", domainIds: ["eng", "des"], cells: { "q:a": "No" } },
];
const ids = (params: string, keys = ["q:a"]) =>
  filterBoardRows(rows, keys, new URLSearchParams(params)).map((r) => r.userId);

describe("filterBoardRows", () => {
  it("keeps every row with no filters", () => {
    expect(ids("term=t1")).toEqual(["u1", "u2", "u3"]);
  });

  it("searches name and email", () => {
    expect(ids("q=ALAN")).toEqual(["u3"]);
    expect(ids("q=example.edu")).toEqual(["u1", "u3"]);
  });

  it("narrows to a domain", () => {
    expect(ids("domain=des")).toEqual(["u2", "u3"]);
  });

  it("applies column filters and ignores ones for columns the board doesn't show", () => {
    expect(ids("f.q:a=No")).toEqual(["u2", "u3"]);
    expect(ids("f.q:a=No", [])).toEqual(["u1", "u2", "u3"]);
  });

  it("combines all three", () => {
    expect(ids("q=a&domain=eng&f.q:a=No")).toEqual(["u3"]);
  });
});
