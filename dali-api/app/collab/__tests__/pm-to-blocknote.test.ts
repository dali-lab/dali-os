import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { mapPmDocToBlocks, ensureBlocks } from "../legacy/pm-to-blocknote";
import { blocksToPmDoc } from "../legacy/blocknote-to-pm";
import { blocksToFragment, fragmentToBlocks, type DocBlock } from "../blocknote-server";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import type { PMNode } from "../export-html";

function doc(...content: PMNode[]): PMNode {
  return { type: "doc", content };
}

function p(text: string): PMNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function map(...content: PMNode[]) {
  return mapPmDocToBlocks(doc(...content));
}

describe("mapPmDocToBlocks — every legacy node type", () => {
  it("maps paragraphs and headings h1–h6 (levels preserved)", () => {
    const { blocks, losses } = map(
      p("hello"),
      ...[1, 2, 3, 4, 5, 6].map((level) => ({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: `H${level}` }],
      })),
    );
    expect(losses).toEqual([]);
    expect(blocks[0]).toMatchObject({ type: "paragraph", content: [{ type: "text", text: "hello" }] });
    for (let i = 1; i <= 6; i++) {
      expect(blocks[i]).toMatchObject({ type: "heading", props: { level: i } });
    }
  });

  it("maps marks: bold/italic/underline/strike/code → styles", () => {
    const { blocks } = map({
      type: "paragraph",
      content: [
        { type: "text", text: "b", marks: [{ type: "bold" }] },
        { type: "text", text: "i", marks: [{ type: "italic" }] },
        { type: "text", text: "u", marks: [{ type: "underline" }] },
        { type: "text", text: "s", marks: [{ type: "strike" }] },
        { type: "text", text: "c", marks: [{ type: "code" }] },
      ],
    });
    const content = blocks[0]!.content as { text?: string; styles?: Record<string, unknown> }[];
    expect(content[0]!.styles).toEqual({ bold: true });
    expect(content[1]!.styles).toEqual({ italic: true });
    expect(content[2]!.styles).toEqual({ underline: true });
    expect(content[3]!.styles).toEqual({ strike: true });
    expect(content[4]!.styles).toEqual({ code: true });
  });

  it("maps textStyle color → textColor and highlight → backgroundColor", () => {
    const { blocks } = map({
      type: "paragraph",
      content: [
        { type: "text", text: "red", marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }] },
        { type: "text", text: "hi", marks: [{ type: "highlight", attrs: { color: "#FEF3C7" } }] },
        { type: "text", text: "plain-hi", marks: [{ type: "highlight" }] },
      ],
    });
    const content = blocks[0]!.content as { styles?: Record<string, unknown> }[];
    expect(content[0]!.styles).toEqual({ textColor: "#ff0000" });
    expect(content[1]!.styles).toEqual({ backgroundColor: "#FEF3C7" });
    // Colorless legacy highlight still highlights.
    expect(content[2]!.styles).toEqual({ backgroundColor: "yellow" });
  });

  it("maps link marks to link inline content (styles preserved inside)", () => {
    const { blocks } = map({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "go",
          marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://x.test" } }],
        },
      ],
    });
    expect(blocks[0]!.content).toEqual([
      {
        type: "link",
        href: "https://x.test",
        content: [{ type: "text", text: "go", styles: { bold: true } }],
      },
    ]);
  });

  it("maps hardBreak to \\n inside the surrounding text run", () => {
    const { blocks } = map({
      type: "paragraph",
      content: [
        { type: "text", text: "line1" },
        { type: "hardBreak" },
        { type: "text", text: "line2" },
      ],
    });
    const content = blocks[0]!.content as { text?: string }[];
    expect(content.map((c) => c.text).join("|")).toBe("line1\n|line2");
  });

  it("maps nested bullet lists (items flattened to siblings, nesting as children)", () => {
    const { blocks, losses } = map({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            p("top"),
            {
              type: "bulletList",
              content: [{ type: "listItem", content: [p("nested")] }],
            },
          ],
        },
        { type: "listItem", content: [p("second")] },
      ],
    });
    expect(losses).toEqual([]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: "bulletListItem",
      content: [{ type: "text", text: "top" }],
    });
    expect(blocks[0]!.children).toHaveLength(1);
    expect(blocks[0]!.children[0]).toMatchObject({ type: "bulletListItem" });
    expect(blocks[1]).toMatchObject({ type: "bulletListItem" });
  });

  it("maps ordered lists with a non-default start", () => {
    const { blocks } = map({
      type: "orderedList",
      attrs: { start: 4 },
      content: [
        { type: "listItem", content: [p("four")] },
        { type: "listItem", content: [p("five")] },
      ],
    });
    expect(blocks[0]).toMatchObject({ type: "numberedListItem", props: { start: 4 } });
    expect(blocks[1]!.props.start).toBeUndefined();
  });

  it("maps taskList/taskItem → checkListItem with checked state", () => {
    const { blocks } = map({
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: true }, content: [p("done")] },
        { type: "taskItem", attrs: { checked: false }, content: [p("todo")] },
      ],
    });
    expect(blocks[0]).toMatchObject({ type: "checkListItem", props: { checked: true } });
    expect(blocks[1]).toMatchObject({ type: "checkListItem", props: { checked: false } });
  });

  it("maps blockquote → quote (first paragraph inline, rest children)", () => {
    const { blocks } = map({
      type: "blockquote",
      content: [p("wise words"), p("second line")],
    });
    expect(blocks[0]).toMatchObject({
      type: "quote",
      content: [{ type: "text", text: "wise words" }],
    });
    expect(blocks[0]!.children[0]).toMatchObject({ type: "paragraph" });
  });

  it("maps codeBlock with language", () => {
    const { blocks } = map({
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [{ type: "text", text: "const x = 1;" }],
    });
    expect(blocks[0]).toMatchObject({
      type: "codeBlock",
      props: { language: "typescript" },
      content: [{ type: "text", text: "const x = 1;" }],
    });
  });

  it("maps horizontalRule → divider", () => {
    const { blocks, losses } = map({ type: "horizontalRule" });
    expect(blocks[0]!.type).toBe("divider");
    expect(losses).toEqual([]);
  });

  it("maps image src/alt/align/width → url/caption/textAlignment/previewWidth", () => {
    const { blocks } = map({
      type: "image",
      attrs: { src: "/api/upload/raw?key=k1", alt: "diagram", align: "right", width: 320 },
    });
    expect(blocks[0]).toMatchObject({
      type: "image",
      props: {
        url: "/api/upload/raw?key=k1",
        caption: "diagram",
        textAlignment: "right",
        previewWidth: 320,
      },
    });
  });

  it("maps toggleBlock (summary → inline content, body → children)", () => {
    const { blocks } = map({
      type: "toggleBlock",
      attrs: { open: true },
      content: [
        { type: "toggleSummary", content: [{ type: "text", text: "More" }] },
        p("hidden detail"),
      ],
    });
    expect(blocks[0]).toMatchObject({
      type: "toggleListItem",
      content: [{ type: "text", text: "More" }],
    });
    expect(blocks[0]!.children[0]).toMatchObject({ type: "paragraph" });
  });

  it("maps a summary-less toggle with an empty summary", () => {
    const { blocks } = map({
      type: "toggleBlock",
      content: [p("legacy body")],
    });
    expect(blocks[0]!.type).toBe("toggleListItem");
    expect(blocks[0]!.content).toEqual([]);
    expect(blocks[0]!.children).toHaveLength(1);
  });

  it("maps callout (paragraph lead → inline, rest → children)", () => {
    const { blocks } = map({
      type: "callout",
      attrs: { emoji: "⚠️" },
      content: [p("heads up"), p("details")],
    });
    expect(blocks[0]).toMatchObject({
      type: "callout",
      props: { emoji: "⚠️" },
      content: [{ type: "text", text: "heads up" }],
    });
    expect(blocks[0]!.children).toHaveLength(1);
  });

  it("maps a callout whose first child is not a paragraph to empty inline + children", () => {
    const { blocks } = map({
      type: "callout",
      content: [
        { type: "bulletList", content: [{ type: "listItem", content: [p("li")] }] },
      ],
    });
    expect(blocks[0]!.content).toEqual([]);
    expect(blocks[0]!.children[0]).toMatchObject({ type: "bulletListItem" });
  });

  it("maps tables with a header row", () => {
    const cell = (tag: string, text: string): PMNode => ({
      type: tag,
      content: [p(text)],
    });
    const { blocks } = map({
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader", "A"), cell("tableHeader", "B")] },
        { type: "tableRow", content: [cell("tableCell", "1"), cell("tableCell", "2")] },
      ],
    });
    const table = blocks[0]!;
    expect(table.type).toBe("table");
    const content = table.content as { headerRows?: number; rows: { cells: { content: unknown[] }[] }[] };
    expect(content.headerRows).toBe(1);
    expect(content.rows).toHaveLength(2);
    expect(content.rows[0]!.cells).toHaveLength(2);
    expect(blocksToPlainText([table])).toBe("A B\n1 2");
  });

  it("maps mention attrs → props 1:1", () => {
    const { blocks } = map({
      type: "paragraph",
      content: [{ type: "mention", attrs: { id: "u1", label: "kiran" } }],
    });
    expect(blocks[0]!.content).toEqual([{ type: "mention", props: { id: "u1", label: "kiran" } }]);
  });

  it("maps every signing field type + variable with attrs → props 1:1", () => {
    const fields = ["signatureField", "dateField", "initialField", "checkboxField", "textField"];
    const { blocks, losses } = map({
      type: "paragraph",
      content: [
        ...fields.map((type) => ({
          type,
          attrs: { fieldId: `f-${type}`, role: "member", required: true, value: type === "checkboxField" ? true : "" },
        })),
        { type: "variable", attrs: { name: "term", value: "26S" } },
      ],
    });
    expect(losses).toEqual([]);
    const content = blocks[0]!.content as { type: string; props: Record<string, unknown> }[];
    for (const type of fields) {
      const node = content.find((c) => c.type === type)!;
      expect(node.props).toMatchObject({ fieldId: `f-${type}`, role: "member", required: true });
    }
    // Boolean checkbox values stringify (props are string-typed).
    expect(content.find((c) => c.type === "checkboxField")!.props.value).toBe("true");
    expect(content.find((c) => c.type === "variable")!.props).toEqual({ name: "term", value: "26S" });
  });

  it("drops lineHeight with a loss entry", () => {
    const { blocks, losses } = map({
      type: "paragraph",
      attrs: { lineHeight: "1.5" },
      content: [{ type: "text", text: "spaced" }],
    });
    expect(blocks[0]!.type).toBe("paragraph");
    expect(losses.some((l) => l.includes("lineHeight"))).toBe(true);
  });

  it("maps unknown nodes to a paragraph with extracted text + loss entry", () => {
    const { blocks, losses } = map({
      type: "mysteryEmbed",
      content: [p("do not lose me")],
    });
    expect(blocks[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "do not lose me" }],
    });
    expect(losses.some((l) => l.includes("mysteryEmbed"))).toBe(true);
  });

  it("handles malformed input without throwing", () => {
    expect(mapPmDocToBlocks(null).blocks).toEqual([]);
    expect(mapPmDocToBlocks("nope").blocks).toEqual([]);
    expect(mapPmDocToBlocks({}).blocks).toEqual([]);
    expect(mapPmDocToBlocks({ type: "paragraph", content: [] }).blocks).toHaveLength(1);
  });
});

describe("mapper output is schema-valid (Y round-trip through the real BlockNote schema)", () => {
  it("survives blocksToFragment → fragmentToBlocks for a kitchen-sink doc", () => {
    const { blocks } = map(
      p("intro"),
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "T" }] },
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [p("li")] }],
      },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true }, content: [p("t")] }],
      },
      { type: "blockquote", content: [p("q")] },
      { type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "x" }] },
      { type: "horizontalRule" },
      { type: "image", attrs: { src: "https://x.test/i.png", alt: "a", width: 100 } },
      {
        type: "toggleBlock",
        content: [
          { type: "toggleSummary", content: [{ type: "text", text: "s" }] },
          p("b"),
        ],
      },
      { type: "callout", attrs: { emoji: "💡" }, content: [p("c")] },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableHeader", content: [p("h")] }],
          },
          {
            type: "tableRow",
            content: [{ type: "tableCell", content: [p("d")] }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "mention", attrs: { id: "u1", label: "k" } },
          { type: "signatureField", attrs: { fieldId: "f1", role: "member", required: true } },
          { type: "variable", attrs: { name: "term" } },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
        ],
      },
    );

    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment("blocknote");
    blocksToFragment(blocks, fragment);
    const roundTripped = fragmentToBlocks(fragment);

    // Same block types in order, same plain text — proves every mapped block
    // validated against the real schema and nothing was dropped.
    expect(roundTripped.map((b) => b.type)).toEqual(blocks.map((b) => b.type));
    expect(blocksToPlainText(roundTripped)).toBe(blocksToPlainText(blocks));
    // ids survive the Y round-trip exactly.
    expect(roundTripped.map((b) => b.id)).toEqual(blocks.map((b) => b.id));
  });
});

describe("ensureBlocks format sniffing", () => {
  it("passes block arrays through untouched", () => {
    const blocks: DocBlock[] = [
      { id: "b1", type: "paragraph", props: {}, content: [], children: [] },
    ];
    expect(ensureBlocks(blocks)).toBe(blocks);
  });

  it("maps legacy ProseMirror docs", () => {
    const out = ensureBlocks(doc(p("legacy")));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "paragraph" });
  });

  it("returns [] for null / undefined / {} / non-doc objects", () => {
    expect(ensureBlocks(null)).toEqual([]);
    expect(ensureBlocks(undefined)).toEqual([]);
    expect(ensureBlocks({})).toEqual([]);
    expect(ensureBlocks({ foo: 1 })).toEqual([]);
    expect(ensureBlocks("text")).toEqual([]);
  });
});

describe("blocksToPmDoc (compat reverse mapper)", () => {
  it("reconstructs legacy structures for read-only PM renderers", () => {
    const { blocks } = map(
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "T" }] },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [p("one")] },
          { type: "listItem", content: [p("two")] },
        ],
      },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true }, content: [p("t")] }],
      },
      { type: "horizontalRule" },
      { type: "image", attrs: { src: "https://x.test/i.png", alt: "pic", width: 200, align: "left" } },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "see ", marks: [] },
          { type: "text", text: "docs", marks: [{ type: "link", attrs: { href: "https://d.test" } }] },
          { type: "mention", attrs: { id: "u1", label: "k" } },
        ],
      },
    );
    const pm = blocksToPmDoc(blocks);
    expect(pm.type).toBe("doc");
    const types = (pm.content ?? []).map((n) => n.type);
    expect(types).toEqual(["heading", "bulletList", "taskList", "horizontalRule", "image", "paragraph"]);
    const list = pm.content![1]!;
    expect(list.content).toHaveLength(2);
    expect(list.content![0]!.type).toBe("listItem");
    const image = pm.content![4]!;
    expect(image.attrs).toMatchObject({ src: "https://x.test/i.png", alt: "pic", width: 200, align: "left" });
    const para = pm.content![5]!;
    const link = para.content!.find((n) => n.marks?.some((m) => m.type === "link"));
    expect(link?.marks?.[0]?.attrs?.href).toBe("https://d.test");
    expect(para.content!.some((n) => n.type === "mention")).toBe(true);
  });
});
