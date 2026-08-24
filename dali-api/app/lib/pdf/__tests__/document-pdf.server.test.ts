import { describe, it, expect, vi } from "vitest";

// Force the headless path to fail so we exercise the pdfkit fallback — the
// safety net that keeps a download / receipt email working when Chromium is
// unavailable or crashes.
vi.mock("~/lib/pdf/render.server", () => ({
  renderHtmlToPdf: vi.fn(async () => {
    throw new Error("no chromium in this env");
  }),
}));

import { renderDocumentPdf } from "~/lib/pdf/document-pdf.server";

function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

describe("renderDocumentPdf", () => {
  it("falls back to the pdfkit renderer when the headless render fails", async () => {
    const blocks = [
      { id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "Hi", styles: {} }], children: [] },
    ];
    const pdf = await renderDocumentPdf("Doc", blocks as never);
    expect(isPdf(pdf)).toBe(true);
  });
});
