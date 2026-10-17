import { describe, it, expect } from "vitest";
import { moveById } from "~/lib/favorites-order";

const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
const ids = (l: { id: string }[]) => l.map((x) => x.id);

describe("moveById", () => {
  it("moves right and left", () => {
    expect(ids(moveById(list, "a", 1))).toEqual(["b", "a", "c"]);
    expect(ids(moveById(list, "c", -1))).toEqual(["a", "c", "b"]);
  });

  it("returns the same list at the edges and for unknown ids", () => {
    expect(moveById(list, "a", -1)).toBe(list);
    expect(moveById(list, "c", 1)).toBe(list);
    expect(moveById(list, "zzz", 1)).toBe(list);
  });

  it("does not mutate its input", () => {
    moveById(list, "a", 2);
    expect(ids(list)).toEqual(["a", "b", "c"]);
  });
});
