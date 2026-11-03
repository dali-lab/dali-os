import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  dropInvalidYArrayItems,
  moveYArrayItem,
  replaceYArrayItem,
} from "../useSharedCollection";

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

const mapOf = (item: Record<string, unknown>) => {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(item)) m.set(k, v);
  return m;
};

// Two clients on one room: each edits offline, then they exchange updates.
function twoClients() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const sync = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  };
  return { a: a.getArray<Y.Map<unknown>>("items"), b: b.getArray<Y.Map<unknown>>("items"), sync };
}

// The whole-list replace the builder used for every edit before the fix.
function replaceAll(yarray: Y.Array<Y.Map<unknown>>, items: Record<string, unknown>[]) {
  yarray.doc!.transact(() => {
    yarray.delete(0, yarray.length);
    yarray.push(items.map(mapOf));
  });
}

describe("replaceYArrayItem", () => {
  it("overwrites one item and leaves the others alone", () => {
    const yarray = arrayOf(["a", "b", "c"]);
    replaceYArrayItem(yarray, 1, { key: "b", data: { label: "B!" } });
    expect(snapshot(yarray)).toEqual([
      { key: "a", data: { label: "a" } },
      { key: "b", data: { label: "B!" } },
      { key: "c", data: { label: "c" } },
    ]);
  });

  it("removes fields the new item no longer has", () => {
    const yarray = arrayOf(["a"]);
    yarray.get(0).set("required", true);
    replaceYArrayItem(yarray, 0, { key: "a", data: { label: "a" } });
    expect(snapshot(yarray)).toEqual([{ key: "a", data: { label: "a" } }]);
  });

  it("ignores an index past the end", () => {
    const yarray = arrayOf(["a"]);
    replaceYArrayItem(yarray, 5, { key: "z" });
    expect(snapshot(yarray).map((i) => i.key)).toEqual(["a"]);
  });

  it("merges concurrent edits to different items without duplicating", () => {
    const { a, b, sync } = twoClients();
    a.push([mapOf({ key: "q1", label: "One" }), mapOf({ key: "q2", label: "Two" })]);
    sync();

    replaceYArrayItem(a, 0, { key: "q1", label: "One (a)" });
    replaceYArrayItem(b, 1, { key: "q2", label: "Two (b)" });
    sync();

    expect(snapshot(a)).toEqual([
      { key: "q1", label: "One (a)" },
      { key: "q2", label: "Two (b)" },
    ]);
    expect(snapshot(b)).toEqual(snapshot(a));
  });

  it("whole-list replaces from two clients duplicate the list (the bug)", () => {
    const { a, b, sync } = twoClients();
    a.push([mapOf({ key: "q1" }), mapOf({ key: "q2" })]);
    sync();

    replaceAll(a, [{ key: "q1", label: "a" }, { key: "q2" }]);
    replaceAll(b, [{ key: "q1" }, { key: "q2", label: "b" }]);
    sync();

    expect(a.length).toBe(4);
  });
});

describe("dropInvalidYArrayItems", () => {
  it("drops later items whose field repeats an earlier one", () => {
    const yarray = arrayOf(["a", "b", "a", "c", "b"]);
    expect(dropInvalidYArrayItems(yarray, "key")).toBe(true);
    expect(snapshot(yarray).map((i) => i.key)).toEqual(["a", "b", "c"]);
  });

  it("drops empty maps", () => {
    const yarray = arrayOf(["a"]);
    yarray.insert(0, [new Y.Map<unknown>()]);
    expect(dropInvalidYArrayItems(yarray)).toBe(true);
    expect(snapshot(yarray).map((i) => i.key)).toEqual(["a"]);
  });

  it("keeps repeats when no field is given", () => {
    const yarray = arrayOf(["a", "a"]);
    expect(dropInvalidYArrayItems(yarray)).toBe(false);
    expect(yarray.length).toBe(2);
  });

  it("keeps items that lack the field", () => {
    const yarray = arrayOf(["a"]);
    yarray.push([mapOf({ data: {} }), mapOf({ data: {} })]);
    expect(dropInvalidYArrayItems(yarray, "key")).toBe(false);
    expect(yarray.length).toBe(3);
  });

  it("returns false and writes nothing when the list is clean", () => {
    const yarray = arrayOf(["a", "b"]);
    const updates: Uint8Array[] = [];
    yarray.doc!.on("update", (u: Uint8Array) => updates.push(u));
    expect(dropInvalidYArrayItems(yarray, "key")).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("repairs two clients seeding the same empty room", () => {
    const { a, b, sync } = twoClients();
    const seed = [{ key: "q1" }, { key: "q2" }];
    a.push(seed.map(mapOf));
    b.push(seed.map(mapOf));
    sync();
    expect(a.length).toBe(4);

    dropInvalidYArrayItems(a, "key");
    dropInvalidYArrayItems(b, "key");
    sync();

    expect(snapshot(a).map((i) => i.key)).toEqual(["q1", "q2"]);
    expect(snapshot(b)).toEqual(snapshot(a));
  });
});
