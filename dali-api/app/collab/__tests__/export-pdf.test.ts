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

  // The check-list branch draws a vector box (checked vs unchecked) and advances
  // the cursor for the label — exercise both so a positioning/drawing bug throws.
  it("renders checked and unchecked check-list items", async () => {
    const pdf = await renderBlocksToPdf("Checklist", [
      { type: "checkListItem", props: { checked: true }, content: [{ type: "text", text: "Done" }], children: [] },
      { type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: "Todo" }], children: [] },
    ] as never);
    expect(isPdf(pdf)).toBe(true);
  });

  it("renders a representative mixed document (headings, lists, quote, divider)", async () => {
    const pdf = await renderBlocksToPdf("Agreement", [
      { type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Terms" }], children: [] },
      { type: "paragraph", content: [{ type: "text", text: "Dear signer," }], children: [] },
      { type: "bulletListItem", content: [{ type: "text", text: "Point one" }], children: [] },
      { type: "numberedListItem", content: [{ type: "text", text: "First" }], children: [] },
      { type: "quote", content: [{ type: "text", text: "A note" }], children: [] },
      { type: "divider", children: [] },
    ] as never);
    expect(isPdf(pdf)).toBe(true);
  });
});
