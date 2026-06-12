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

  it("renders empty doc as trailing newline only", () => {
    const md = renderMarkdown(doc([]));
    expect(md).toBe("\n");
  });
});
