import { describe, it, expect } from "vitest";

import { renderMarkdown } from "~/collab/export-markdown";
import type { PMNode } from "~/collab/export-html";

const doc = (content: PMNode[]): PMNode => ({ type: "doc", content });

describe("renderMarkdown", () => {
  it("renders headings, paragraphs, and inline marks", () => {
    const md = renderMarkdown(
      doc([
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world", marks: [{ type: "bold" }] },
          ],
        },
      ]),
    );
    expect(md).toContain("# Title");
    expect(md).toContain("**world**");
  });

  it("renders bullet lists with nesting", () => {
    const md = renderMarkdown(
      doc([
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "outer" }] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "inner" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(md).toContain("- outer");
    expect(md).toContain("  - inner");
  });

  it("renders ordered lists with sequential numbers", () => {
    const md = renderMarkdown(
      doc([
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }],
            },
          ],
        },
      ]),
    );
    expect(md).toContain("1. first");
    expect(md).toContain("2. second");
  });

  it("renders code blocks with language fence", () => {
    const md = renderMarkdown(
      doc([
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ]),
    );
    expect(md).toContain("```ts");
    expect(md).toContain("const x = 1;");
  });

  it("renders blockquote", () => {
    const md = renderMarkdown(
      doc([
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "quoted" }] }],
        },
      ]),
    );
    expect(md.trim().startsWith("> quoted")).toBe(true);
  });

  it("renders underline and highlight marks as HTML passthrough", () => {
    const md = renderMarkdown(
      doc([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "under", marks: [{ type: "underline" }] },
            { type: "text", text: " and " },
            { type: "text", text: "mark", marks: [{ type: "highlight" }] },
          ],
        },
      ]),
    );
    expect(md).toContain("<u>under</u>");
    expect(md).toContain("<mark>mark</mark>");
  });

  it("renders a toggle block as <details> with its summary + body", () => {
    const md = renderMarkdown(
      doc([
        {
          type: "toggleBlock",
          attrs: { open: true },
          content: [
            { type: "toggleSummary", content: [{ type: "text", text: "Details" }] },
            { type: "paragraph", content: [{ type: "text", text: "hidden body" }] },
          ],
        },
      ]),
    );
    expect(md).toContain("<summary>Details</summary>");
    expect(md).toContain("hidden body");
  });

  it("falls back to a Toggle label when a toggle has no summary (legacy)", () => {
    const md = renderMarkdown(
      doc([
        {
          type: "toggleBlock",
          attrs: { open: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "legacy body" }] }],
        },
      ]),
    );
    expect(md).toContain("<summary>Toggle</summary>");
    expect(md).toContain("legacy body");
  });

  it("renders a callout as an emoji-prefixed blockquote", () => {
    const md = renderMarkdown(
      doc([
        {
          type: "callout",
          attrs: { emoji: "💡" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "note text" }] }],
        },
      ]),
    );
    expect(md).toContain("> 💡 note text");
  });

  it("renders a task list with GFM checkboxes", () => {
    const md = renderMarkdown(
      doc([
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] },
            { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "todo" }] }] },
          ],
        },
      ]),
    );
    expect(md).toContain("- [x] done");
    expect(md).toContain("- [ ] todo");
  });

  it("renders a table as a GFM pipe table", () => {
    const md = renderMarkdown(
      doc([
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
      ]),
    );
    expect(md).toContain("| A | B |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("escapes backslashes and pipes in table cells", () => {
    const md = renderMarkdown(
      doc([
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "a|b" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "c\\d" }] }] },
              ],
            },
          ],
        },
      ]),
    );
    // Pipe escaped so it can't split the cell; backslash escaped first so "\|"
    // never collapses into an unescaped delimiter.
    expect(md).toContain("a\\|b");
    expect(md).toContain("c\\\\d");
  });

  it("renders empty doc as trailing newline only", () => {
    const md = renderMarkdown(doc([]));
    expect(md).toBe("\n");
  });
});
