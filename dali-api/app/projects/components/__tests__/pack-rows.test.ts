import { describe, it, expect } from "vitest";
import { packRows } from "../EpicsTimeline";

// `packRows` takes drawn pixel extents, so the fixtures are written in pixels
// rather than dates. ROW_MIN_GAP is 16: two bars share a row only when the
// later one starts at least that far past the end of everything before it.
type Bar = { id: string; start: number; end: number };
const pack = (bars: Bar[]) => packRows(bars, (b) => ({ start: b.start, end: b.end }));

describe("packRows", () => {
  it("puts everything on one row when nothing overlaps", () => {
    const rows = pack([
      { id: "a", start: 0, end: 100 },
      { id: "b", start: 150, end: 250 },
      { id: "c", start: 300, end: 400 },
    ]);
    expect([...rows.values()]).toEqual([0, 0, 0]);
  });

  it("gives an overlapping bar a row of its own", () => {
    const rows = pack([
      { id: "a", start: 0, end: 200 },
      { id: "b", start: 100, end: 300 },
    ]);
    expect(rows.get("a")).toBe(0);
    expect(rows.get("b")).toBe(1);
  });

  it("keeps bars apart when they only just touch", () => {
    // 8px of clearance is under ROW_MIN_GAP, so these would read as one bar.
    const rows = pack([
      { id: "a", start: 0, end: 100 },
      { id: "b", start: 108, end: 200 },
    ]);
    expect(rows.get("a")).toBe(0);
    expect(rows.get("b")).toBe(1);
  });

  it("reuses the first row that has cleared, not the last one opened", () => {
    // `c` clears `a` but not `b`, so it belongs back on row 0.
    const rows = pack([
      { id: "a", start: 0, end: 100 },
      { id: "b", start: 50, end: 400 },
      { id: "c", start: 150, end: 250 },
    ]);
    expect(rows.get("a")).toBe(0);
    expect(rows.get("b")).toBe(1);
    expect(rows.get("c")).toBe(0);
  });

  it("measures a row by its furthest end, not its last-assigned bar", () => {
    // `b` ends before `a` does. A row tracking only the most recent end would
    // then let `c` in beside them, overlapping `a`.
    const rows = pack([
      { id: "a", start: 0, end: 500 },
      { id: "b", start: 0, end: 100 },
      { id: "c", start: 200, end: 300 },
    ]);
    expect(rows.get("c")).not.toBe(rows.get("a"));
  });

  it("assigns rows in start order whatever order it is given", () => {
    const forwards = pack([
      { id: "a", start: 0, end: 100 },
      { id: "b", start: 50, end: 200 },
    ]);
    const backwards = pack([
      { id: "b", start: 50, end: 200 },
      { id: "a", start: 0, end: 100 },
    ]);
    expect(forwards.get("a")).toBe(0);
    expect(backwards.get("a")).toBe(0);
    expect(backwards.get("b")).toBe(1);
  });

  it("handles an empty set", () => {
    expect(pack([]).size).toBe(0);
  });
});
