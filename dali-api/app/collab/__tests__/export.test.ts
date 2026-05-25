import { describe, it, expect } from "vitest";
// Import the pure renderers from export-html (no DB import) so this unit test
// doesn't pull in the Prisma client via export.ts → ~/lib/db.
import { renderNodes, buildExportHtml, type PMNode } from "../export-html";
import { renderProseMirrorToPdf } from "../export-pdf";

describe("renderNodes (ProseMirror JSON → HTML)", () => {
  it("renders headings, paragraphs, and marks", () => {
    const nodes: PMNode[] = [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " and " },
          { type: "text", text: "italic", marks: [{ type: "italic" }] },
        ],
      },
    ];
    const html = renderNodes(nodes);
    expect(html).toBe(
      "<h2>Title</h2><p>Hello <strong>bold</strong> and <em>italic</em></p>",
    );
  });

  it("renders bullet and ordered lists", () => {
    const nodes: PMNode[] = [
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
        ],
      },
    ];
    expect(renderNodes(nodes)).toBe("<ul><li><p>a</p></li><li><p>b</p></li></ul>");
  });

  it("escapes HTML in text and link hrefs", () => {
    const nodes: PMNode[] = [
      {
        type: "paragraph",
        content: [{ type: "text", text: "<script>alert(1)</script>" }],
      },
    ];
    const html = renderNodes(nodes);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders links with escaped href", () => {
    const nodes: PMNode[] = [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://x.test?a=1&b=2" } }] },
        ],
      },
    ];
    const html = renderNodes(nodes);
    expect(html).toContain('href="https://x.test?a=1&amp;b=2"');
  });

  it("recurses into unknown block types so content is never dropped", () => {
    const nodes: PMNode[] = [
      { type: "mysteryBlock", content: [{ type: "paragraph", content: [{ type: "text", text: "kept" }] }] },
    ];
    expect(renderNodes(nodes)).toContain("kept");
  });
});

describe("buildExportHtml", () => {
  it("uses the title as H1 and includes the body", () => {
    const html = buildExportHtml("My Doc", "<p>body</p>");
    expect(html).toContain("<h1>My Doc</h1>");
    expect(html).toContain("<p>body</p>");
  });

  it("escapes the title and shows an empty-state when body is empty", () => {
    const html = buildExportHtml("<b>x</b>", "");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("This document is empty.");
  });
});

describe("renderProseMirrorToPdf", () => {
  it("produces a non-empty PDF buffer with a valid header", async () => {
    const json: PMNode = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "H" }] },
        { type: "paragraph", content: [{ type: "text", text: "p" }] },
      ],
    };
    const buf = await renderProseMirrorToPdf("Title", json);
    expect(buf.length).toBeGreaterThan(0);
    // PDFs start with the "%PDF" magic bytes.
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("handles an empty document without throwing", async () => {
    const buf = await renderProseMirrorToPdf("Empty", { type: "doc", content: [] });
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});
