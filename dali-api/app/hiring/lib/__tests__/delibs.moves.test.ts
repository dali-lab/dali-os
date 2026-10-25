import { describe, it, expect } from "vitest";
import { applyMove, dropCard } from "~/hiring/lib/delibs";

const columns = ["No Decision", "Interview", "Reject"] as const;
const board = () => ({ "No Decision": ["a", "b", "c"], Interview: ["x", "y"], Reject: [] as string[] });

describe("dropCard", () => {
  it("moves a card down within its column to the hovered card's slot", () => {
    expect(dropCard(board(), "a", "c", columns)).toEqual({
      order: { "No Decision": ["b", "c", "a"], Interview: ["x", "y"], Reject: [] },
      toColumn: "No Decision",
    });
  });

  it("moves a card up within its column to the hovered card's slot", () => {
    expect(dropCard(board(), "c", "a", columns)?.order["No Decision"]).toEqual(["c", "a", "b"]);
  });

  it("moves a card one step down", () => {
    expect(dropCard(board(), "a", "b", columns)?.order["No Decision"]).toEqual(["b", "a", "c"]);
  });

  it("sends a card to the end when dropped on its own column's empty space", () => {
    expect(dropCard(board(), "a", "No Decision", columns)?.order["No Decision"]).toEqual(["b", "c", "a"]);
  });

  it("inserts before the hovered card in another column", () => {
    expect(dropCard(board(), "b", "y", columns)).toEqual({
      order: { "No Decision": ["a", "c"], Interview: ["x", "b", "y"], Reject: [] },
      toColumn: "Interview",
    });
  });

  it("appends when dropped on another column's shell", () => {
    expect(dropCard(board(), "b", "Reject", columns)).toEqual({
      order: { "No Decision": ["a", "c"], Interview: ["x", "y"], Reject: ["b"] },
      toColumn: "Reject",
    });
  });

  it("is a no-op when dropped on itself", () => {
    expect(dropCard(board(), "a", "a", columns)).toBeNull();
  });

  it("is a no-op when the last card is dropped on its own column", () => {
    expect(dropCard(board(), "c", "No Decision", columns)).toBeNull();
  });

  it("is a no-op for an unknown drop target", () => {
    expect(dropCard(board(), "a", "ghost", columns)).toBeNull();
  });

  it("does not mutate the input order", () => {
    const order = board();
    dropCard(order, "a", "y", columns);
    expect(order).toEqual(board());
  });
});

describe("applyMove", () => {
  it("appends to the target when no visible order is sent", () => {
    expect(applyMove({ "No Decision": ["a"], Interview: ["x"] }, columns, "a", "Interview")).toEqual({
      "No Decision": [],
      Interview: ["x", "a"],
      Reject: [],
    });
  });

  it("saves the visible order, including never-moved cards the saved order lacks", () => {
    // Nothing saved yet: a, b, c only exist in the default column client side.
    expect(applyMove({}, columns, "c", "No Decision", ["c", "a", "b"])).toEqual({
      "No Decision": ["c", "a", "b"],
      Interview: [],
      Reject: [],
    });
  });

  it("reorders within a saved column", () => {
    expect(applyMove({ Interview: ["x", "y", "z"] }, columns, "z", "Interview", ["z", "x", "y"]).Interview).toEqual([
      "z",
      "x",
      "y",
    ]);
  });

  it("drops cards another lead has moved to a different column since", () => {
    const current = { Interview: ["x"], Reject: ["y"] };
    expect(applyMove(current, columns, "x", "Interview", ["y", "x"])).toEqual({
      "No Decision": [],
      Interview: ["x"],
      Reject: ["y"],
    });
  });

  it("keeps cards another lead has moved into the target since, at the end", () => {
    const current = { Interview: ["x", "new"] };
    expect(applyMove(current, columns, "x", "Interview", ["x"]).Interview).toEqual(["x", "new"]);
  });

  it("falls back to appending when the visible order omits the moved card", () => {
    expect(applyMove({ Interview: ["x"] }, columns, "a", "Interview", ["x"]).Interview).toEqual(["x", "a"]);
  });

  it("removes the moved card from its old column", () => {
    const next = applyMove({ "No Decision": ["a", "b"] }, columns, "a", "Reject", ["a"]);
    expect(next["No Decision"]).toEqual(["b"]);
    expect(next.Reject).toEqual(["a"]);
  });

  it("dedupes repeated ids in the visible order", () => {
    expect(applyMove({}, columns, "a", "Interview", ["a", "b", "a"]).Interview).toEqual(["a", "b"]);
  });
});
