import { describe, it, expect } from "vitest";
import { renderBlocksToPdf, renderProseMirrorToPdf } from "~/collab/export-pdf";

// A well-formed PDF buffer starts with the "%PDF-" magic bytes.
function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

describe("export-pdf renderer robustness", () => {
  // Regression: signing frozen bodies are stored as block JSON and passed
  // through ensureBlocks un-normalized, so a nested block can arrive without a
  // `children` array. The walker must treat that as "no children", not crash.
  it("renders a block missing its children array without throwing", async () => {
    const blocks = [
      { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
    ] as never;
    const pdf = await renderBlocksToPdf("Test", blocks);
    expect(isPdf(pdf)).toBe(true);
  });

  it("skips malformed (null / non-object) blocks instead of crashing", async () => {
    const blocks = [
      null,
      { type: "paragraph", content: [{ type: "text", text: "Ok" }] },
    ] as never;
    const pdf = await renderBlocksToPdf("Test", blocks);
    expect(isPdf(pdf)).toBe(true);
  });

  it("renderProseMirrorToPdf accepts block JSON arrays", async () => {
    const pdf = await renderProseMirrorToPdf("Doc", [
      {
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "H" }],
        children: [],
      },
    ] as never);
    expect(isPdf(pdf)).toBe(true);
  });

  it("renders a table (cells as tableCell objects or bare inline arrays)", async () => {
    const pdf = await renderBlocksToPdf("Doc", [
      {
        id: "t",
        type: "table",
        props: {},
        content: {
          type: "tableContent",
          columnWidths: [200, null],
          headerRows: 1,
          rows: [
            { cells: [[{ type: "text", text: "A" }], { type: "tableCell", content: [{ type: "text", text: "B" }] }] },
            { cells: [[{ type: "text", text: "1" }]] },
          ],
        },
        children: [],
      },
    ] as never);
    expect(isPdf(pdf)).toBe(true);
  });
});
