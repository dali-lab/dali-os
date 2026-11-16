import { describe, expect, it } from "vitest";
import { blocksToPlainText } from "../note-preview";

describe("blocksToPlainText", () => {
  it("joins block text, including nested children, and skips empty blocks", () => {
    const blocks = [
      { content: [{ type: "text", text: "Shipped the " }, { type: "text", text: "badge" }], children: [] },
      { content: [], children: [] },
      { content: "Plain string", children: [{ content: [{ type: "text", text: "Nested" }], children: [] }] },
    ];
    expect(blocksToPlainText(blocks)).toBe("Shipped the badge\nPlain string\nNested");
  });

  it("returns an empty string for non-array input", () => {
    expect(blocksToPlainText(null)).toBe("");
    expect(blocksToPlainText({})).toBe("");
  });

  it("truncates long notes with an ellipsis", () => {
    const out = blocksToPlainText([{ content: "a".repeat(50), children: [] }], 10);
    expect(out).toBe(`${"a".repeat(10)}…`);
  });
});
