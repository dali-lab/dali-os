import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { moveYArrayItem } from "../useSharedCollection";

function arrayOf(keys: string[]) {
  const doc = new Y.Doc();
  const yarray = doc.getArray<Y.Map<unknown>>("items");
  yarray.push(
    keys.map((k) => {
      const m = new Y.Map<unknown>();
      m.set("key", k);
      m.set("data", { label: k });
      return m;
    }),
  );
  return yarray;
}

const snapshot = (yarray: Y.Array<Y.Map<unknown>>) =>
  yarray.toArray().map((m) => Object.fromEntries(m.entries()));

describe("moveYArrayItem", () => {
  // Regression: re-inserting the deleted Y.Map left an empty `{}` behind and
  // lost the moved item's content.
  it("keeps the moved item's content", () => {
    const yarray = arrayOf(["a", "b", "c"]);
    moveYArrayItem(yarray, 2, 0);
    expect(snapshot(yarray)).toEqual([
      { key: "c", data: { label: "c" } },
      { key: "a", data: { label: "a" } },
      { key: "b", data: { label: "b" } },
    ]);
  });

  it("lands the item at `to` when moving down, like a splice", () => {
    const yarray = arrayOf(["a", "b", "c"]);
    moveYArrayItem(yarray, 0, 2);
    expect(snapshot(yarray).map((i) => i.key)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op when from === to", () => {
    const yarray = arrayOf(["a", "b"]);
    moveYArrayItem(yarray, 1, 1);
    expect(snapshot(yarray).map((i) => i.key)).toEqual(["a", "b"]);
  });
});
