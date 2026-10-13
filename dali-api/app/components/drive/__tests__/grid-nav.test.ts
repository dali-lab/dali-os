import { describe, expect, it } from "vitest";
import { gridStep, gridStepBlocks, perRowFromTops } from "~/components/drive/grid-nav";

describe("perRowFromTops", () => {
  it("counts the tiles that share the first tile's row", () => {
    expect(perRowFromTops([0, 0, 0, 120, 120, 120])).toBe(3);
  });
  it("is the whole list when everything fits on one row", () => {
    expect(perRowFromTops([8, 8])).toBe(2);
  });
  it("is one for a single tile or a single column", () => {
    expect(perRowFromTops([0])).toBe(1);
    expect(perRowFromTops([0, 40, 80])).toBe(1);
  });
  it("is one for nothing", () => {
    expect(perRowFromTops([])).toBe(1);
  });
});

describe("gridStep", () => {
  // 7 tiles, 3 per row:  0 1 2 / 3 4 5 / 6
  it("moves a whole row down and up, keeping the column", () => {
    expect(gridStep(7, 3, 1, 1)).toBe(4);
    expect(gridStep(7, 3, 5, -1)).toBe(2);
  });
  it("lands on the last tile when the row below is shorter", () => {
    expect(gridStep(7, 3, 5, 1)).toBe(6);
    expect(gridStep(7, 3, 4, 1)).toBe(6);
  });
  it("stays put on the first row going up and the last row going down", () => {
    expect(gridStep(7, 3, 1, -1)).toBe(1);
    expect(gridStep(7, 3, 6, 1)).toBe(6);
    expect(gridStep(7, 3, 4, 1)).toBe(6);
    expect(gridStep(6, 3, 4, 1)).toBe(4);
  });
  it("starts at the first tile when nothing is focused", () => {
    expect(gridStep(7, 3, -1, 1)).toBe(0);
    expect(gridStep(7, 3, -1, -1)).toBe(0);
  });
  it("has nowhere to go with no tiles", () => {
    expect(gridStep(0, 3, -1, 1)).toBe(-1);
  });
  it("treats a one-wide grid as a list", () => {
    expect(gridStep(4, 1, 1, 1)).toBe(2);
    expect(gridStep(4, 1, 0, -1)).toBe(0);
  });
  it("tolerates a zero or negative width", () => {
    expect(gridStep(4, 0, 1, 1)).toBe(2);
  });
});

describe("gridStepBlocks", () => {
  // band of 3 on one row (0 1 2), then 5 tiles 2 per row: 3 4 / 5 6 / 7
  const blocks = [
    { count: 3, perRow: 3 },
    { count: 5, perRow: 2 },
  ];
  it("steps inside a block like gridStep", () => {
    expect(gridStepBlocks(blocks, 3, 1)).toBe(5);
    expect(gridStepBlocks(blocks, 6, -1)).toBe(4);
  });
  it("enters the block below at the same column, clamped to what is there", () => {
    expect(gridStepBlocks(blocks, 0, 1)).toBe(3);
    expect(gridStepBlocks(blocks, 1, 1)).toBe(4);
    expect(gridStepBlocks(blocks, 2, 1)).toBe(4);
  });
  it("enters the block above on its last row, at the same column", () => {
    expect(gridStepBlocks(blocks, 3, -1)).toBe(0);
    expect(gridStepBlocks(blocks, 4, -1)).toBe(1);
    const tall = [{ count: 5, perRow: 2 }, { count: 2, perRow: 2 }];
    expect(gridStepBlocks(tall, 5, -1)).toBe(4);
    expect(gridStepBlocks(tall, 6, -1)).toBe(4);
  });
  it("stays at the very first and very last row", () => {
    expect(gridStepBlocks(blocks, 1, -1)).toBe(1);
    expect(gridStepBlocks(blocks, 7, 1)).toBe(7);
  });
  it("skips an empty block", () => {
    expect(gridStepBlocks([{ count: 2, perRow: 2 }, { count: 0, perRow: 1 }, { count: 2, perRow: 2 }], 0, 1)).toBe(2);
  });
  it("starts at the first tile when nothing is focused, and nowhere with no tiles", () => {
    expect(gridStepBlocks(blocks, -1, 1)).toBe(0);
    expect(gridStepBlocks([], -1, 1)).toBe(-1);
  });
});
