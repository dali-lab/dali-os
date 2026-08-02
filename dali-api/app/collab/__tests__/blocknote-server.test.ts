import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  blocksToFragment,
  blocksToHtml,
  blocksToMarkdown,
  fragmentToBlocks,
  markdownToBlocks,
  plainTextToBlocks,
  type DocBlock,
} from "../blocknote-server";
import { mapPmDocToBlocks } from "../legacy/pm-to-blocknote";
import { blocksToPlainText } from "~/components/doc/schema/configs";

const BASE = { backgroundColor: "default", textColor: "default", textAlignment: "left" };

function para(content: DocBlock["content"]): DocBlock {
  return { id: crypto.randomUUID(), type: "paragraph", props: { ...BASE }, content, children: [] };
}

describe("markdown round-trip through the custom server schema", () => {
  const CORPUS = `# Title

Some **bold** and *italic* with a [link](https://example.com/docs).

* Bullet one
* Bullet two

1. Ordered

> Quoted

\`\`\`typescript
const x = 1;
\`\`\`

* [x] done task

| A | B |
| - | - |
| 1 | 2 |
`;

  it("markdown → blocks → markdown preserves structure and text", async () => {
    const blocks = await markdownToBlocks(CORPUS);
    const types = blocks.map((b) => b.type);
    expect(types).toContain("heading");
    expect(types).toContain("bulletListItem");
    expect(types).toContain("numberedListItem");
    expect(types).toContain("quote");
    expect(types).toContain("codeBlock");
    expect(types).toContain("checkListItem");
    expect(types).toContain("table");

    const regenerated = await blocksToMarkdown(blocks);
    expect(regenerated).toContain("# Title");
    expect(regenerated).toContain("**bold**");
    expect(regenerated).toContain("*italic*");
    expect(regenerated).toContain("[link](https://example.com/docs)");
    expect(regenerated).toContain("```typescript");
    expect(regenerated).toContain("> Quoted");
    expect(regenerated).toContain("* [x] done task");

    const reparsed = await markdownToBlocks(regenerated);
    expect(reparsed.map((b) => b.type)).toEqual(types);
    expect(blocksToPlainText(reparsed)).toBe(blocksToPlainText(blocks));
  });

  it("custom inline content serializes to plain-text markdown forms", async () => {
    const blocks: DocBlock[] = [
      para([
        { type: "text", text: "Hi ", styles: {} },
        { type: "mention", props: { id: "u1", label: "kiran" } },
        { type: "text", text: ", sign ", styles: {} },
        {
          type: "signatureField",
          props: { fieldId: "f1", role: "member", label: "", placeholder: "", value: "", required: true },
        },
        { type: "text", text: " for ", styles: {} },
        { type: "variable", props: { name: "term", value: "26S" } },
      ]),
    ];
    const markdown = await blocksToMarkdown(blocks);
    expect(markdown).toContain("@kiran");
    expect(markdown).toContain("__________");
    expect(markdown).toContain("26S");
    // No HTML junk leaks into the markdown.
    expect(markdown).not.toContain("<span");
  });
});

describe("blocksToHtml", () => {
  it("renders semantic HTML with custom nodes as text-bearing spans", async () => {
    const blocks: DocBlock[] = [
      {
        id: "h1",
        type: "heading",
        props: { ...BASE, level: 2 },
        content: [{ type: "text", text: "Section", styles: {} }],
        children: [],
      },
      para([
        { type: "mention", props: { id: "u1", label: "kiran" } },
        { type: "text", text: " highlighted", styles: { backgroundColor: "#FEF3C7" } },
      ]),
      {
        id: "c1",
        type: "callout",
        props: { emoji: "⚠️" },
        content: [{ type: "text", text: "careful", styles: {} }],
        children: [],
      },
      { id: "d1", type: "divider", props: {}, content: undefined, children: [] },
    ];
    const html = await blocksToHtml(blocks);
    expect(html).toContain("<h2");
    expect(html).toContain("@kiran");
    expect(html).toContain("careful");
    expect(html).toContain("<hr");
  });

  it("renders empty documents to an empty string", async () => {
    expect(await blocksToHtml([])).toBe("");
  });
});

describe("blocksToFragment / fragmentToBlocks", () => {
  it("REPLACES existing fragment content (write.ts + restoreVersion depend on this)", () => {
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment("blocknote");
    blocksToFragment(plainTextToBlocks("first version"), fragment);
    blocksToFragment(plainTextToBlocks("second version"), fragment);
    expect(blocksToPlainText(fragmentToBlocks(fragment))).toBe("second version");
  });

  it("round-trips a legacy-mapped doc through a Yjs encode/decode cycle", () => {
    const { blocks } = mapPmDocToBlocks({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hello ", marks: [{ type: "bold" }] },
            { type: "mention", attrs: { id: "u9", label: "sam" } },
          ],
        },
      ],
    });
    const ydoc = new Y.Doc();
    blocksToFragment(blocks, ydoc.getXmlFragment("blocknote"));

    const update = Y.encodeStateAsUpdate(ydoc);
    const ydoc2 = new Y.Doc();
    Y.applyUpdate(ydoc2, update);

    const out = fragmentToBlocks(ydoc2.getXmlFragment("blocknote"));
    expect(out).toHaveLength(1);
    const content = out[0]!.content as { type: string; props?: Record<string, unknown> }[];
    expect(content.some((c) => c.type === "mention" && c.props?.id === "u9")).toBe(true);
  });
});

describe("plainTextToBlocks", () => {
  it("emits one paragraph per line, preserving blank lines as empty paragraphs", () => {
    const blocks = plainTextToBlocks("one\n\nthree");
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(blocksToPlainText(blocks)).toBe("one\nthree");
  });
});
