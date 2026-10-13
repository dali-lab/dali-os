import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  addSelection,
  destinationKey,
  isLocked,
  isSelected,
  primaryIndex,
  primaryOf,
  removeSelection,
  selectionFrom,
  setPrimary,
  toResult,
  toggleSelection,
} from "~/components/drive/picker-multi";
import type { Destination } from "~/components/drive/FolderPicker";

const a: Destination = { driveId: "lab", folderId: "a" };
const b: Destination = { driveId: "core", folderId: "b" };
const c: Destination = { driveId: "projects", folderId: null };

describe("addSelection", () => {
  it("makes the first destination primary", () => {
    const sel = addSelection(EMPTY_SELECTION, a);
    expect(sel.items).toEqual([a]);
    expect(primaryOf(sel)).toEqual(a);
  });

  it("keeps the primary when more are added, in the order picked", () => {
    const sel = addSelection(addSelection(addSelection(EMPTY_SELECTION, a), b), c);
    expect(sel.items).toEqual([a, b, c]);
    expect(primaryOf(sel)).toEqual(a);
  });

  it("ignores a destination that is already selected", () => {
    const once = addSelection(EMPTY_SELECTION, a);
    expect(addSelection(once, { ...a })).toBe(once);
  });

  it("tells two folders apart by drive as well as folder id", () => {
    const sel = addSelection(addSelection(EMPTY_SELECTION, { driveId: "x", folderId: "f" }), { driveId: "y", folderId: "f" });
    expect(sel.items).toHaveLength(2);
  });
});

describe("removeSelection", () => {
  it("promotes the first remaining destination when the primary goes", () => {
    const sel = removeSelection(selectionFrom([a, b, c]), a);
    expect(sel.items).toEqual([b, c]);
    expect(primaryOf(sel)).toEqual(b);
  });

  it("leaves the primary alone when another goes", () => {
    const sel = removeSelection(selectionFrom([a, b, c], 1), a);
    expect(primaryOf(sel)).toEqual(b);
    expect(primaryIndex(sel)).toBe(0);
  });

  it("empties out with no primary", () => {
    const sel = removeSelection(selectionFrom([a]), a);
    expect(sel).toEqual({ items: [], primary: null });
    expect(primaryIndex(sel)).toBe(-1);
    expect(toResult(sel)).toBeNull();
  });

  it("skips destinations that can't be primary when promoting", () => {
    const sel = removeSelection(selectionFrom([a, b, c]), a, (d) => destinationKey(d) !== destinationKey(b));
    expect(primaryOf(sel)).toEqual(c);
    expect(sel.items).toEqual([b, c]);
  });

  it("has no primary when every remaining destination is ineligible", () => {
    const sel = removeSelection(selectionFrom([a, b]), a, () => false);
    expect(sel).toEqual({ items: [b], primary: null });
    expect(toResult(sel)).toBeNull();
  });

  it("is a no-op for something that was never selected", () => {
    const sel = selectionFrom([a]);
    expect(removeSelection(sel, b)).toBe(sel);
  });
});

describe("toggleSelection", () => {
  it("adds, then removes", () => {
    const on = toggleSelection(EMPTY_SELECTION, a);
    expect(isSelected(on, a)).toBe(true);
    expect(isSelected(toggleSelection(on, a), a)).toBe(false);
  });
});

describe("setPrimary", () => {
  it("moves the primary without reordering the chips", () => {
    const sel = setPrimary(selectionFrom([a, b, c]), c);
    expect(sel.items).toEqual([a, b, c]);
    expect(primaryOf(sel)).toEqual(c);
    expect(primaryIndex(sel)).toBe(2);
  });

  it("ignores a destination that isn't selected", () => {
    const sel = selectionFrom([a]);
    expect(setPrimary(sel, b)).toBe(sel);
  });
});

describe("selectionFrom", () => {
  it("honours the given primary index", () => {
    expect(primaryOf(selectionFrom([a, b], 1))).toEqual(b);
  });

  it("drops repeats and keeps the primary on the right chip", () => {
    const sel = selectionFrom([a, a, b], 2);
    expect(sel.items).toEqual([a, b]);
    expect(primaryOf(sel)).toEqual(b);
  });

  it("falls back to the first when the index points at a dropped repeat or nothing", () => {
    expect(primaryOf(selectionFrom([a, a, b], 1))).toEqual(a);
    expect(primaryOf(selectionFrom([a, b], 9))).toEqual(a);
  });

  it("is empty for no destinations", () => {
    expect(selectionFrom([])).toEqual(EMPTY_SELECTION);
  });
});

describe("toResult", () => {
  it("is the contract onConfirm receives: destinations in pick order plus the primary's index", () => {
    expect(toResult(setPrimary(selectionFrom([a, b, c]), b))).toEqual({ destinations: [a, b, c], primaryIndex: 1 });
  });
});

describe("isLocked", () => {
  it("matches by key", () => {
    expect(isLocked([a], { ...a })).toBe(true);
    expect(isLocked([a], b)).toBe(false);
    expect(isLocked(undefined, a)).toBe(false);
  });
});

describe("destinationKey", () => {
  it("separates a drive's top level from a folder", () => {
    expect(destinationKey(c)).not.toBe(destinationKey({ driveId: "projects", folderId: "" + "x" }));
  });
});
