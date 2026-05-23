import { describe, it, expect } from "vitest";
import { buildColumnOrder, INITIAL_COLUMNS } from "~/hiring/lib/delibs";

const columns = INITIAL_COLUMNS;
const defaultColumn = columns[0]; // "No Decision"

describe("buildColumnOrder", () => {
  it("sweeps never-moved apps into the default column (the disappearing-card regression)", () => {
    // Saved order only contains apps that have been moved; "a" and "d" were never moved.
    const saved = { Interview: ["b"], Reject: ["c"] };
    const result = buildColumnOrder(saved, ["a", "b", "c", "d"], columns, defaultColumn);

    // Every loaded app is present somewhere.
    const all = Object.values(result).flat();
    expect(all.sort()).toEqual(["a", "b", "c", "d"]);
    // Moved apps stay where the server put them.
    expect(result.Interview).toEqual(["b"]);
    expect(result.Reject).toEqual(["c"]);
    // Never-moved apps land in the default column.
    expect(result[defaultColumn]).toEqual(["a", "d"]);
  });

  it("drops saved IDs that are no longer in the loaded set", () => {
    const saved = { Interview: ["b", "ghost"], Reject: [] };
    const result = buildColumnOrder(saved, ["a", "b"], columns, defaultColumn);

    expect(Object.values(result).flat()).not.toContain("ghost");
    expect(result.Interview).toEqual(["b"]);
    expect(result[defaultColumn]).toEqual(["a"]);
  });

  it("dedupes an ID that appears in more than one saved column", () => {
    const saved = { Interview: ["a"], Reject: ["a"] };
    const result = buildColumnOrder(saved, ["a"], columns, defaultColumn);

    const all = Object.values(result).flat();
    expect(all).toEqual(["a"]);
    // First column wins.
    expect(result.Interview).toEqual(["a"]);
    expect(result.Reject).toEqual([]);
  });

  it("places everything in the default column when there is no saved order", () => {
    expect(buildColumnOrder({}, ["a", "b"], columns, defaultColumn)).toEqual({
      "No Decision": ["a", "b"],
      Interview: [],
      Reject: [],
    });
    expect(buildColumnOrder(null, ["a"], columns, defaultColumn)).toEqual({
      "No Decision": ["a"],
      Interview: [],
      Reject: [],
    });
  });

  it("returns empty columns when there are no loaded apps", () => {
    expect(buildColumnOrder({ Interview: ["stale"] }, [], columns, defaultColumn)).toEqual({
      "No Decision": [],
      Interview: [],
      Reject: [],
    });
  });

  it("preserves the order of loaded apps swept into the default column", () => {
    const result = buildColumnOrder({}, ["z", "y", "x"], columns, defaultColumn);
    expect(result[defaultColumn]).toEqual(["z", "y", "x"]);
  });
});
