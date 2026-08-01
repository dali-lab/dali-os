// Unit tests for pure helpers in apply.ts.
// blockExcerpt and filterCheckedBlocks have no DOM/BlockNote dependencies.

import { describe, it, expect } from "vitest";
import { blockExcerpt, filterCheckedBlocks } from "../apply";
import type { DocPartialBlock } from "../../schema/build";

// ── blockExcerpt ──────────────────────────────────────────────────────────────

describe("blockExcerpt", () => {
  function makeTextBlock(text: string, type = "paragraph"): DocPartialBlock {
    return {
      type,
      content: [{ type: "text", text }],
    } as unknown as DocPartialBlock;
  }

  it("returns empty string for a block with no content", () => {
    const block = { type: "paragraph" } as unknown as DocPartialBlock;
    expect(blockExcerpt(block)).toBe("");
  });

  it("returns the text of a short paragraph", () => {
    const block = makeTextBlock("Hello world");
    expect(blockExcerpt(block)).toBe("Hello world");
  });

  it("truncates at maxLen and appends ellipsis", () => {
    const long = "a".repeat(200);
    const block = makeTextBlock(long);
    const result = blockExcerpt(block);
    expect(result.length).toBeLessThanOrEqual(101); // 100 chars + "…"
    expect(result.endsWith("…")).toBe(true);
  });

  it("respects a custom maxLen", () => {
    const block = makeTextBlock("abcdefghij");
    expect(blockExcerpt(block, 5)).toBe("abcde…");
  });

  it("returns empty string when content is an empty array", () => {
    const block = { type: "paragraph", content: [] } as unknown as DocPartialBlock;
    expect(blockExcerpt(block)).toBe("");
  });

  it("concatenates multiple text nodes", () => {
    const block = {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
    } as unknown as DocPartialBlock;
    expect(blockExcerpt(block)).toBe("Hello world");
  });

  it("skips non-text inline nodes (e.g. mentions)", () => {
    const block = {
      type: "paragraph",
      content: [
        { type: "text", text: "Hi " },
        { type: "mention", attrs: { id: "u1" } },
        { type: "text", text: "there" },
      ],
    } as unknown as DocPartialBlock;
    expect(blockExcerpt(block)).toBe("Hi there");
  });

  it("falls back to [type] label for non-array content (e.g. table)", () => {
    const block = {
      type: "table",
      content: { type: "tableContent", rows: [] },
    } as unknown as DocPartialBlock;
    const result = blockExcerpt(block);
    expect(result).toBe("[table]");
  });

  it("returns empty string when content is a string", () => {
    const block = { type: "paragraph", content: "raw string" } as unknown as DocPartialBlock;
    expect(blockExcerpt(block)).toBe("");
  });
});

// ── filterCheckedBlocks ───────────────────────────────────────────────────────

describe("filterCheckedBlocks", () => {
  function makeBlocks(n: number): DocPartialBlock[] {
    return Array.from({ length: n }, (_, i) => ({
      type: "paragraph",
      content: [{ type: "text", text: `Block ${i}` }],
    } as unknown as DocPartialBlock));
  }

  it("returns all blocks when all indices are checked", () => {
    const blocks = makeBlocks(3);
    const checked = new Set([0, 1, 2]);
    expect(filterCheckedBlocks(blocks, checked)).toHaveLength(3);
  });

  it("returns empty array when no indices are checked", () => {
    const blocks = makeBlocks(3);
    expect(filterCheckedBlocks(blocks, new Set())).toHaveLength(0);
  });

  it("returns only the checked subset", () => {
    const blocks = makeBlocks(4);
    const result = filterCheckedBlocks(blocks, new Set([0, 2]));
    expect(result).toHaveLength(2);
    // Verify identity — same object references.
    expect(result[0]).toBe(blocks[0]);
    expect(result[1]).toBe(blocks[2]);
  });

  it("handles a single-block array", () => {
    const blocks = makeBlocks(1);
    expect(filterCheckedBlocks(blocks, new Set([0]))).toHaveLength(1);
    expect(filterCheckedBlocks(blocks, new Set())).toHaveLength(0);
  });

  it("preserves original order", () => {
    const blocks = makeBlocks(5);
    const result = filterCheckedBlocks(blocks, new Set([4, 2, 0]));
    expect(result.map((b) => (b.content as { text: string }[])[0].text)).toEqual([
      "Block 0",
      "Block 2",
      "Block 4",
    ]);
  });
});
