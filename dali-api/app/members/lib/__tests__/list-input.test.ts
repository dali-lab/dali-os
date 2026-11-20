import { describe, expect, it } from "vitest";
import { splitList } from "../list-input";

describe("splitList", () => {
  it("splits on commas, semicolons and newlines", () => {
    expect(splitList("a, b; c\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("trims entries and drops empty ones", () => {
    expect(splitList("  a ,, ;  \n b  ,")).toEqual(["a", "b"]);
  });

  it("keeps spaces inside an entry and duplicates as typed", () => {
    expect(splitList("Machine learning, Machine learning")).toEqual(["Machine learning", "Machine learning"]);
  });

  it("returns nothing for blank input", () => {
    expect(splitList("")).toEqual([]);
    expect(splitList(" \n ; , ")).toEqual([]);
  });
});
