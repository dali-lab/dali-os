// Unit tests for findMatchRanges — pure node environment, no DOM/BlockNote.

import { describe, expect, it } from "vitest";
import { findMatchRanges, type DocLike, type NodeLike } from "./findMatchRanges";

// Minimal PM-doc builder: takes a list of {pos, text} leaves.
function makeDoc(textLeaves: { pos: number; text: string }[]): DocLike {
  return {
    nodeSize: textLeaves.reduce((max, { pos, text }) => Math.max(max, pos + text.length + 2), 2),
    nodesBetween(from, to, f) {
      for (const { pos, text } of textLeaves) {
        if (pos + text.length < from || pos > to) continue;
        const node: NodeLike = { isText: true, text, nodeSize: text.length };
        f(node, pos);
      }
    },
  };
}

// A doc with one structural (non-text) node that nodesBetween will visit.
function makeDocWithNonTextNode(): DocLike {
  return {
    nodeSize: 10,
    nodesBetween(_from, _to, f) {
      // Non-text node: f must NOT collect matches from it.
      const block: NodeLike = { isText: false, text: "hello", nodeSize: 7 };
      f(block, 1);
      const leaf: NodeLike = { isText: true, text: "world", nodeSize: 5 };
      f(leaf, 4);
    },
  };
}

describe("findMatchRanges", () => {
  it("returns empty array for empty needle", () => {
    const doc = makeDoc([{ pos: 1, text: "hello" }]);
    expect(findMatchRanges(doc, "")).toEqual([]);
  });

  it("returns empty array when needle not found", () => {
    const doc = makeDoc([{ pos: 1, text: "hello world" }]);
    expect(findMatchRanges(doc, "xyz")).toEqual([]);
  });

  it("finds a single match", () => {
    const doc = makeDoc([{ pos: 1, text: "hello world" }]);
    expect(findMatchRanges(doc, "world")).toEqual([{ from: 7, to: 12 }]);
  });

  it("is case-insensitive", () => {
    const doc = makeDoc([{ pos: 1, text: "Hello WORLD hello World" }]);
    const matches = findMatchRanges(doc, "hello");
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ from: 1, to: 6 });
    expect(matches[1]).toEqual({ from: 13, to: 18 });
  });

  it("finds multiple non-overlapping matches in one text node", () => {
    const doc = makeDoc([{ pos: 1, text: "aaa" }]);
    // "aa" appears at offset 0 and 1 (overlapping). We allow overlapping.
    const matches = findMatchRanges(doc, "aa");
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ from: 1, to: 3 });
    expect(matches[1]).toEqual({ from: 2, to: 4 });
  });

  it("collects matches across multiple text leaves", () => {
    const doc = makeDoc([
      { pos: 1, text: "find me" },
      { pos: 10, text: "also find here" },
    ]);
    const matches = findMatchRanges(doc, "find");
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ from: 1, to: 5 });
    expect(matches[1]).toEqual({ from: 15, to: 19 });
  });

  it("skips non-text nodes", () => {
    // block node has text "hello" but isText=false; only "world" leaf is text.
    const doc = makeDocWithNonTextNode();
    expect(findMatchRanges(doc, "hello")).toEqual([]);
    expect(findMatchRanges(doc, "world")).toEqual([{ from: 4, to: 9 }]);
  });

  it("handles needle longer than any text node", () => {
    const doc = makeDoc([{ pos: 1, text: "hi" }]);
    expect(findMatchRanges(doc, "hello world")).toEqual([]);
  });

  it("handles match at position 0 of a text node", () => {
    const doc = makeDoc([{ pos: 2, text: "abc" }]);
    expect(findMatchRanges(doc, "abc")).toEqual([{ from: 2, to: 5 }]);
  });
});
