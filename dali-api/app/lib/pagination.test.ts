import { describe, expect, it } from "vitest";
import {
  CURSOR_DONE,
  decodeCursor,
  encodeCursor,
  joinPairCursor,
  keysetAfter,
  keysetPage,
  offsetPage,
  offsetWindow,
  parsePageParam,
  splitPairCursor,
} from "./pagination";

describe("parsePageParam", () => {
  it.each([
    [null, 1],
    [undefined, 1],
    ["", 1],
    ["abc", 1],
    ["0", 1],
    ["-3", 1],
    ["Infinity", 1],
    ["2.9", 2],
    ["7", 7],
  ])("reads %s as page %s", (raw, page) => {
    expect(parsePageParam(raw)).toBe(page);
  });
});

describe("offset paging", () => {
  it("overfetches one row to detect a next page", () => {
    expect(offsetWindow(1, 50)).toEqual({ skip: 0, take: 51 });
    expect(offsetWindow(3, 50)).toEqual({ skip: 100, take: 51 });
  });

  it("trims the probe row and reports hasNext", () => {
    expect(offsetPage([1, 2, 3], 2)).toEqual({ items: [1, 2], hasNext: true });
  });

  it("has no next page on an exact fit", () => {
    expect(offsetPage([1, 2], 2)).toEqual({ items: [1, 2], hasNext: false });
  });
});

describe("cursors", () => {
  const cursor = { at: "2026-10-30T12:00:00.000Z", id: "abc" };

  it("round-trips", () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("keeps a pipe inside the id", () => {
    expect(decodeCursor("2026-10-30T12:00:00.000Z|a|b")).toEqual({
      at: "2026-10-30T12:00:00.000Z",
      id: "a|b",
    });
  });

  it.each([[null], [undefined], [""], ["nopipe"], ["|id"], ["not-a-date|id"], ["2026-10-30T12:00:00.000Z|"]])(
    "rejects %s",
    (raw) => {
      expect(decodeCursor(raw)).toBeNull();
    },
  );
});

describe("pair cursors", () => {
  it("reads a missing cursor as both lists at the start", () => {
    expect(splitPairCursor(null)).toEqual([null, null]);
    expect(splitPairCursor("start~start")).toEqual([null, null]);
  });

  it("keeps each list's position", () => {
    expect(splitPairCursor("a|1~done")).toEqual(["a|1", CURSOR_DONE]);
  });

  it("marks a finished list done and ends when both are finished", () => {
    expect(joinPairCursor("a|1", null)).toBe("a|1~done");
    expect(joinPairCursor(null, "b|2")).toBe("done~b|2");
    expect(joinPairCursor(null, null)).toBeNull();
  });
});

describe("keysetPage", () => {
  const rows = [
    { at: "2026-10-03T00:00:00.000Z", id: "c" },
    { at: "2026-10-02T00:00:00.000Z", id: "b" },
    { at: "2026-10-01T00:00:00.000Z", id: "a" },
  ];

  it("points the cursor at the last kept row", () => {
    expect(keysetPage(rows, 2, (r) => r)).toEqual({
      items: rows.slice(0, 2),
      nextCursor: "2026-10-02T00:00:00.000Z|b",
    });
  });

  it("returns no cursor on the final page", () => {
    expect(keysetPage(rows, 3, (r) => r).nextCursor).toBeNull();
  });
});

describe("keysetAfter", () => {
  it("is empty without a cursor", () => {
    expect(keysetAfter("createdAt", null)).toEqual({});
  });

  it("continues strictly after the cursor row, breaking ties on id", () => {
    const at = new Date("2026-10-30T12:00:00.000Z");
    expect(keysetAfter("createdAt", { at: at.toISOString(), id: "abc" })).toEqual({
      OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "abc" } }],
    });
  });
});
