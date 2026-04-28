import { describe, it, expect } from "vitest";
import { isEmptyDoc } from "../RichTextViewer";

describe("isEmptyDoc", () => {
  it("treats null and undefined as empty", () => {
    expect(isEmptyDoc(null)).toBe(true);
    expect(isEmptyDoc(undefined)).toBe(true);
  });

  it("treats non-doc objects as empty", () => {
    expect(isEmptyDoc({})).toBe(true);
    expect(isEmptyDoc({ type: "paragraph" })).toBe(true);
    expect(isEmptyDoc("hello")).toBe(true);
  });

  it("treats a doc with no content as empty", () => {
    expect(isEmptyDoc({ type: "doc", content: [] })).toBe(true);
    expect(isEmptyDoc({ type: "doc" })).toBe(true);
  });

  it("treats a doc with only empty paragraphs as empty", () => {
    expect(
      isEmptyDoc({
        type: "doc",
        content: [{ type: "paragraph" }],
      }),
    ).toBe(true);
    expect(
      isEmptyDoc({
        type: "doc",
        content: [
          { type: "paragraph", content: [] },
          { type: "paragraph", content: [] },
        ],
      }),
    ).toBe(true);
  });

  it("recognizes a doc with text content as non-empty", () => {
    expect(
      isEmptyDoc({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello" }],
          },
        ],
      }),
    ).toBe(false);
  });
});
