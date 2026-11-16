import { describe, expect, it } from "vitest";
import { moveAmongVisible, parseColumnOp } from "../column-ops";

describe("parseColumnOp", () => {
  it("reads each op", () => {
    expect(parseColumnOp({ op: "show", id: "q1" })).toEqual({ op: "show", id: "q1" });
    expect(parseColumnOp({ op: "hide", id: "q1" })).toEqual({ op: "hide", id: "q1" });
    expect(parseColumnOp({ op: "rename", id: "q1", label: "  When  " })).toEqual({ op: "rename", id: "q1", label: "When" });
    expect(parseColumnOp({ op: "move", id: "q1", dir: -1 })).toEqual({ op: "move", id: "q1", dir: -1 });
    expect(parseColumnOp({ op: "role", id: "q:a", role: "intent-status", termId: "t1" })).toEqual({
      op: "role",
      id: "q:a",
      role: "intent-status",
      termId: "t1",
    });
    expect(parseColumnOp({ op: "role", id: "q:a", role: "project" })).toMatchObject({ termId: null });
    expect(parseColumnOp({ op: "statusMap", id: "q:a", statusMap: { Yes: "Returning" } })).toEqual({
      op: "statusMap",
      id: "q:a",
      statusMap: { Yes: "Returning" },
    });
  });

  it("rejects anything malformed", () => {
    expect(parseColumnOp(null)).toBeNull();
    expect(parseColumnOp({ op: "delete", id: "q1" })).toBeNull();
    expect(parseColumnOp({ op: "show", id: "" })).toBeNull();
    expect(parseColumnOp({ op: "move", id: "q1", dir: 2 })).toBeNull();
    expect(parseColumnOp({ op: "rename", id: "q1", label: "x".repeat(121) })).toBeNull();
    expect(parseColumnOp({ op: "role", id: "q1", role: 3 })).toBeNull();
    expect(parseColumnOp({ op: "statusMap", id: "q1", statusMap: ["Returning"] })).toBeNull();
    expect(parseColumnOp({ op: "statusMap", id: "q1", statusMap: { Yes: 1 } })).toBeNull();
  });
});

describe("moveAmongVisible", () => {
  const visible = (x: string) => !x.startsWith("_");
  it("swaps with the nearest visible neighbour", () => {
    expect(moveAmongVisible(["a", "_b", "c"], 0, 1, visible)).toEqual(["c", "_b", "a"]);
  });
  it("leaves the list alone at an end", () => {
    expect(moveAmongVisible(["a", "_b"], 0, 1, visible)).toEqual(["a", "_b"]);
  });
});
