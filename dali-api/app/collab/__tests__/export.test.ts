import { describe, it, expect } from "vitest";
// Import the pure renderers from export-html (no DB import) so this unit test
// doesn't pull in the Prisma client via export.ts → ~/lib/db.
import { renderNodes, buildExportHtml, type PMNode } from "../export-html";
import { renderBlocksToPdf, renderProseMirrorToPdf } from "../export-pdf";
import { mapPmDocToBlocks } from "../legacy/pm-to-blocknote";

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

  it("renders underline and highlight marks", () => {
    const nodes: PMNode[] = [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "u", marks: [{ type: "underline" }] },
          { type: "text", text: "h", marks: [{ type: "highlight", attrs: { color: "#FEF3C7" } }] },
        ],
      },
    ];
    const html = renderNodes(nodes);
    expect(html).toContain("<u>u</u>");
    expect(html).toContain('<mark style="background-color:#FEF3C7">h</mark>');
  });

  it("renders a toggle block as an open <details> with summary + body", () => {
    const nodes: PMNode[] = [
      {
        type: "toggleBlock",
        attrs: { open: true },
        content: [
          { type: "toggleSummary", content: [{ type: "text", text: "Summary" }] },
          { type: "paragraph", content: [{ type: "text", text: "body" }] },
        ],
      },
    ];
    expect(renderNodes(nodes)).toBe(
      "<details open><summary>Summary</summary><p>body</p></details>",
    );
  });

  it("renders a summary-less (legacy) toggle with a Toggle label", () => {
    const nodes: PMNode[] = [
      {
        type: "toggleBlock",
        attrs: { open: false },
        content: [{ type: "paragraph", content: [{ type: "text", text: "legacy" }] }],
      },
    ];
    expect(renderNodes(nodes)).toBe("<details><summary>Toggle</summary><p>legacy</p></details>");
  });

  it("renders a callout with its emoji marker and body", () => {
    const nodes: PMNode[] = [
      {
        type: "callout",
        attrs: { emoji: "⚠️" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "heads up" }] }],
      },
    ];
    const html = renderNodes(nodes);
    expect(html).toContain("⚠️");
    expect(html).toContain("<p>heads up</p>");
  });

  it("renders a task list with checkbox glyphs", () => {
    const nodes: PMNode[] = [
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] },
          { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "todo" }] }] },
        ],
      },
    ];
    const html = renderNodes(nodes);
    expect(html).toContain("☑ <p>done</p>");
    expect(html).toContain("☐ <p>todo</p>");
  });

  it("renders a table with header and body cells", () => {
    const nodes: PMNode[] = [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }] },
            ],
          },
        ],
      },
    ];
    expect(renderNodes(nodes)).toBe(
      "<table><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></table>",
    );
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

describe("renderProseMirrorToPdf (compat: accepts PM JSON or blocks)", () => {
  it("produces a non-empty PDF buffer with a valid header from PM JSON", async () => {
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

describe("renderBlocksToPdf", () => {
  it("renders a kitchen-sink block document without throwing", async () => {
    const { blocks, losses } = mapPmDocToBlocks({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Doc" }] },
        { type: "paragraph", content: [{ type: "text", text: "intro", marks: [{ type: "bold" }] }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "li" }] }] },
          ],
        },
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
          ],
        },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "t" }] }] },
          ],
        },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "q" }] }] },
        { type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "x()" }] },
        { type: "horizontalRule" },
        { type: "image", attrs: { src: "https://x.test/i.png", alt: "chart" } },
        {
          type: "toggleBlock",
          content: [
            { type: "toggleSummary", content: [{ type: "text", text: "sum" }] },
            { type: "paragraph", content: [{ type: "text", text: "body" }] },
          ],
        },
        { type: "callout", attrs: { emoji: "💡" }, content: [{ type: "paragraph", content: [{ type: "text", text: "note" }] }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "u1", label: "k" } },
            { type: "signatureField", attrs: { fieldId: "f1", role: "member" } },
            { type: "checkboxField", attrs: { fieldId: "f2", role: "member", value: true } },
            { type: "variable", attrs: { name: "term" } },
            { type: "text", text: "linked", marks: [{ type: "link", attrs: { href: "https://d.test" } }] },
          ],
        },
      ],
    });
    expect(losses).toEqual([]);
    const buf = await renderBlocksToPdf("Kitchen Sink", blocks);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("renders the empty-document placeholder for no blocks", async () => {
    const buf = await renderBlocksToPdf("Empty", []);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});
