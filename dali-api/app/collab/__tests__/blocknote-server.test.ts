import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  blocksToFragment,
  blocksToFullHtml,
  blocksToHtml,
  blocksToMarkdown,
  fragmentToBlocks,
  markdownToBlocks,
  plainTextToBlocks,
  type DocBlock,
  type DocInline,
  type DocTableCell,
  type DocTableContent,
} from "../blocknote-server";
import { mapPmDocToBlocks } from "../legacy/pm-to-blocknote";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import { markdownToRichDoc, richDocToMarkdown } from "~/components/slides/slide-markdown.server";

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

describe("hosted video links", () => {
  const URL_ = "https://www.youtube.com/watch?v=OY8fr2E96lg";
  const media = (type: string, props: Record<string, unknown>): DocBlock =>
    ({ id: crypto.randomUUID(), type, props: { ...BASE, ...props }, children: [] }) as unknown as DocBlock;

  it.each(["video", "image"])("a %s block exports a link, never a dead player", async (type) => {
    const html = await blocksToHtml([media(type, { url: URL_, name: "watch?v=OY8fr2E96lg" })]);
    expect(html).toContain(`href="${URL_}"`);
    expect(html).toContain("Watch on YouTube");
    expect(html).not.toMatch(/<video|<img|<iframe/);
  });

  it("keeps the caption", async () => {
    const html = await blocksToHtml([media("video", { url: URL_, caption: "Partner stories" })]);
    expect(html).toContain("Partner stories");
  });

  it("survives a markdown round trip as a video block", async () => {
    const markdown = await blocksToMarkdown([media("video", { url: URL_, name: "Partner stories" })]);
    expect(markdown.trim()).toBe(`![Partner stories](${URL_})`);
    const [block, ...rest] = await markdownToBlocks(markdown);
    expect(rest).toEqual([]);
    expect(block!.type).toBe("video");
    expect(block!.props).toMatchObject({ url: URL_, name: "Partner stories" });
  });

  it("round-trips a video with no name", async () => {
    const [block] = await markdownToBlocks(await blocksToMarkdown([media("video", { url: URL_ })]));
    expect(block!.type).toBe("video");
    expect(block!.props).toMatchObject({ url: URL_ });
  });

  it("keeps a player and a written link to the same video apart", async () => {
    const blocks = await markdownToBlocks(`![Video](${URL_})\n\n[Watch on YouTube](${URL_})\n`);
    expect(blocks.map((block) => block.type)).toEqual(["video", "paragraph"]);
    expect(await blocksToMarkdown(blocks)).toContain(`[Watch on YouTube](${URL_})`);
  });

  it("restores a video nested under a list item", async () => {
    const [item] = await markdownToBlocks(`- Parent\n\n  ![Video](${URL_})\n`);
    expect(item!.children!.map((child) => child.type)).toEqual(["video"]);
  });

  it("leaves real images as images through markdown", async () => {
    const [block] = await markdownToBlocks("![Chart](https://example.com/a.png)\n");
    expect(block!.type).toBe("image");
  });

  it("keeps an uploaded image an image through markdown", async () => {
    const url = "/api/upload/raw?key=uploads%2Fdoc-images%2Fabc-chart.png";
    const blocks = await markdownToBlocks(await blocksToMarkdown([media("image", { url, name: "chart.png" })]));
    expect(blocks[0]).toMatchObject({ type: "image", props: { url } });
  });

  it.each([
    ["an upload", "/api/upload/raw?key=uploads%2Fdoc-images%2Fabc-demo.mp4", "demo.mp4"],
    ["a QuickTime upload", "/api/upload/raw?key=uploads%2Fdoc-images%2Fabc-demo.mov", "demo.mov"],
    ["an uppercase extension", "/api/upload/raw?key=uploads%2Fdoc-images%2Fabc-DEMO.MP4", "DEMO.MP4"],
    ["a direct file with a query string", "https://cdn.example.com/a.webm?sig=1", "a.webm"],
    ["a file named only in the block", "https://cdn.example.com/stream", "demo.mp4"],
  ])("round-trips %s as a video block", async (_label, url, name) => {
    const blocks = await markdownToBlocks(await blocksToMarkdown([media("video", { url, name })]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "video", props: { url, name } });
  });

  it("leaves the iframe out of the PDF dialect too", async () => {
    const html = await blocksToFullHtml([media("video", { url: URL_ })]);
    expect(html).toContain("Watch on YouTube");
    expect(html).not.toContain("<iframe");
  });

  it.each(["video", "image"])("a %s block survives a Yjs round trip unchanged", (type) => {
    const fragment = new Y.Doc().getXmlFragment("doc");
    blocksToFragment([media(type, { url: URL_, name: "n", previewWidth: 400 })], fragment);
    const [block] = fragmentToBlocks(fragment);
    expect(block!.type).toBe(type);
    expect(block!.props).toMatchObject({ url: URL_, name: "n", previewWidth: 400 });
  });

  it("gives an uploaded video controls, so it plays on the public site", async () => {
    const html = await blocksToHtml([
      media("video", { url: "/api/upload/raw?key=uploads/doc-images/demo.mp4" }),
    ]);
    expect(html).toMatch(/<video[^>]*controls/);
    expect(html).toContain('src="/api/upload/raw?key=uploads/doc-images/demo.mp4"');
  });

  it("keeps an uploaded video's caption in a figure", async () => {
    const html = await blocksToHtml([
      media("video", { url: "/api/upload/raw?key=uploads/doc-images/demo.mp4", caption: "Demo" }),
    ]);
    expect(html).toMatch(/<figure[^>]*>.*<video.*<figcaption[^>]*>Demo<\/figcaption>/s);
  });

  it("exports a link when the video preview is off", async () => {
    const html = await blocksToHtml([
      media("video", { url: "https://cdn.example.com/a.mp4", name: "a.mp4", showPreview: false }),
    ]);
    expect(html).toContain('href="https://cdn.example.com/a.mp4"');
    expect(html).not.toContain("<video");
  });

  it("leaves real images alone", async () => {
    const html = await blocksToHtml([media("image", { url: "https://example.com/a.png", name: "A" })]);
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).toContain("<img");
  });
});

describe("taskMention", () => {
  const TASK_CONTENT: DocBlock["content"] = [
    { type: "text", text: "Ship it ", styles: {} },
    { type: "taskMention", props: { taskId: "t1", projectId: "proj1", label: "Ship it" } },
  ];

  it("round-trips through a Yjs encode/decode cycle without loss", () => {
    const ydoc = new Y.Doc();
    blocksToFragment([para(TASK_CONTENT)], ydoc.getXmlFragment("blocknote"));

    const update = Y.encodeStateAsUpdate(ydoc);
    const ydoc2 = new Y.Doc();
    Y.applyUpdate(ydoc2, update);

    const out = fragmentToBlocks(ydoc2.getXmlFragment("blocknote"));
    expect(out).toHaveLength(1);
    const content = out[0]!.content as { type: string; props?: Record<string, unknown> }[];
    const node = content.find((c) => c.type === "taskMention");
    expect(node?.props).toEqual({ taskId: "t1", projectId: "proj1", label: "Ship it" });
  });

  it("plain text renders the label only", () => {
    expect(blocksToPlainText([para(TASK_CONTENT)])).toBe("Ship it Ship it");
  });

  it("markdown export renders the label (as a deep link to the task)", async () => {
    const markdown = await blocksToMarkdown([para(TASK_CONTENT)]);
    expect(markdown).toContain("Ship it");
    expect(markdown).toContain("/projects/proj1?tab=progress&task=t1");
  });

  it("HTML export renders the label as a link to the task", async () => {
    const html = await blocksToHtml([para(TASK_CONTENT)]);
    expect(html).toContain('href="/projects/proj1?tab=progress&amp;task=t1"');
    expect(html).toContain("Ship it");
  });

  it("falls back to 'Untitled task' when the label is empty", async () => {
    const blocks = [para([{ type: "taskMention", props: { taskId: "t2", projectId: "proj1", label: "" } }])];
    expect(await blocksToHtml(blocks)).toContain("Untitled task");
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

describe("column blocks", () => {
  // The client only registers columnList/column on surfaces with the `columns`
  // feature, but the server schema carries them unconditionally. If that ever
  // regresses, the server strips columns out of every document it reads —
  // silently flattening a two-column layout on export and version restore.
  function columnDoc(): DocBlock[] {
    const col = (text: string): DocBlock =>
      ({
        id: crypto.randomUUID(),
        type: "column",
        props: { width: 1 },
        children: [para([{ type: "text", text, styles: {} }])],
      }) as unknown as DocBlock;
    return [
      {
        id: crypto.randomUUID(),
        type: "columnList",
        props: {},
        children: [col("left side"), col("right side")],
      } as unknown as DocBlock,
    ];
  }

  it("survives a Yjs fragment round-trip instead of being stripped", () => {
    const ydoc = new Y.Doc();
    blocksToFragment(columnDoc(), ydoc.getXmlFragment("blocknote"));
    const out = fragmentToBlocks(ydoc.getXmlFragment("blocknote"));

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("columnList");
    const columns = out[0]!.children ?? [];
    expect(columns).toHaveLength(2);
    expect(columns.every((c) => c.type === "column")).toBe(true);
    expect(blocksToPlainText(out)).toContain("left side");
    expect(blocksToPlainText(out)).toContain("right side");
  });

  it("renders both columns into exported HTML", async () => {
    const html = await blocksToHtml(columnDoc());
    expect(html).toContain("left side");
    expect(html).toContain("right side");
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

describe("task blocks", () => {
  const block = {
    id: "b1",
    type: "task",
    props: { taskId: "t1", projectId: "p1", label: "Send the SOW" },
    children: [],
  };

  it("exports the saved title as a link to the task", async () => {
    const html = await blocksToHtml([block] as never);
    expect(html).toContain("/projects/p1?tab=progress&amp;task=t1");
    expect(html).toContain("Send the SOW");
  });

  it("survives a round trip through the collaborative fragment", async () => {
    const fragment = new Y.Doc().getXmlFragment("blocknote");
    blocksToFragment([block] as never, fragment);
    const [back] = fragmentToBlocks(fragment) as unknown as (typeof block)[];
    expect(back!.type).toBe("task");
    expect(back!.props).toMatchObject({ taskId: "t1", projectId: "p1", label: "Send the SOW" });
  });

  it("shows up in the plain text mirror used by search and previews", () => {
    expect(blocksToPlainText([block])).toBe("Send the SOW");
  });
});

describe("component blocks", () => {
  const component = (kind: string, data: unknown) =>
    ({
      id: kind,
      type: "component",
      props: { kind, data: JSON.stringify(data) },
      children: [],
    }) as unknown as DocBlock;

  it("renders a library component to HTML for export and the public site", async () => {
    const html = await blocksToHtml([
      component("cards", {
        fields: { title: "This term" },
        items: [{ tag: "Deadline", tone: "danger", title: "Prototype due", href: "javascript:alert(1)" }],
      }),
    ]);
    expect(html).toContain('data-component="cards"');
    expect(html).toContain("Prototype due");
    expect(html).not.toContain("javascript:");
  });

  it("never exports custom code", async () => {
    const html = await blocksToHtml([
      component("code", { fields: { html: "<script>secret()</script>" }, items: [] }),
    ]);
    expect(html).not.toContain("secret()");
    expect(html).not.toContain("iframe");
  });

  it("survives a Y.Doc round trip", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("blocknote");
    const data = { fields: { title: "T" }, items: [] };
    blocksToFragment([component("links", data)], fragment);
    const [block] = fragmentToBlocks(fragment);
    expect(block?.type).toBe("component");
    expect(JSON.parse(String(block?.props.data))).toEqual(data);
  });
});

describe("inline refs through markdown", () => {
  const REFS_ON = { inlineRefs: true };
  const USER = { type: "mention", props: { id: "u1", label: "kiran" } };
  const PAGE = { type: "pageMention", props: { pageId: "p1", label: "Roadmap" } };
  const TASK = { type: "taskMention", props: { taskId: "t1", projectId: "pr1", label: "Ship it" } };
  const REFS = ["mention", "pageMention", "taskMention"];
  const refsIn = (inlines: unknown) => (inlines as DocInline[]).filter((inline) => REFS.includes(inline.type));
  const cellProps = { backgroundColor: "default", textColor: "default", textAlignment: "left", colspan: 1, rowspan: 1 };
  const cell = (content: DocInline[]): DocTableCell => ({ type: "tableCell", props: cellProps, content });
  const table = (rows: DocInline[][][]): DocBlock => ({
    id: crypto.randomUUID(),
    type: "table",
    props: { textColor: "default" },
    content: { type: "tableContent", columnWidths: rows[0]!.map(() => null), headerRows: 1, rows: rows.map((cells) => ({ cells: cells.map(cell) })) },
    children: [],
  });
  const cellContent = (block: DocBlock | undefined, row: number, col: number) =>
    ((block!.content as DocTableContent).rows[row]!.cells[col] as DocTableCell).content;
  const text = (value: string): DocInline => ({ type: "text", text: value, styles: {} });
  const mixed = [text("Hi "), USER, text(" see "), PAGE, text(" and "), TASK];

  describe("without inlineRefs (the default)", () => {
    it("exports mentions as plain text, as before", async () => {
      const markdown = await blocksToMarkdown([para(mixed)]);
      expect(markdown.trim()).toBe("Hi @kiran see Roadmap and [Ship it](/projects/pr1?tab=progress&task=t1)");
    });

    it("keeps member, page and task links as links", async () => {
      const [block] = await markdownToBlocks(
        "[@kiran](/members/u1) [Plan](/documents/p1) [Fix](/projects/pr1?tab=progress&task=t1)",
      );
      const inlines = block!.content as DocInline[];
      expect(refsIn(inlines)).toEqual([]);
      expect(inlines.filter((inline) => inline.type === "link").map((inline) => inline.href)).toEqual([
        "/members/u1",
        "/documents/p1",
        "/projects/pr1?tab=progress&task=t1",
      ]);
    });

    it("keeps links as links for slide and journey bodies", async () => {
      const doc = await markdownToRichDoc("Read [Plan](/documents/p1) with [@kiran](/members/u1)");
      expect(refsIn((doc[0] as DocBlock).content)).toEqual([]);
      expect(await richDocToMarkdown(doc)).toBe("Read [Plan](/documents/p1) with [@kiran](/members/u1)");
    });
  });

  it("round-trips user, page and task mentions in a paragraph, a list item and a table cell", async () => {
    const blocks: DocBlock[] = [
      para(mixed),
      { id: crypto.randomUUID(), type: "bulletListItem", props: { ...BASE }, content: mixed, children: [] },
      table([[[text("Who")], [text("What")]], [[USER], [PAGE, text(" "), TASK]]]),
    ];
    const markdown = await blocksToMarkdown(blocks, REFS_ON);
    expect(markdown).toContain("[@kiran](/members/u1)");
    expect(markdown).toContain("[Roadmap](/documents/p1)");
    expect(markdown).toContain("[Ship it](/projects/pr1?tab=progress&task=t1)");

    const [paragraph, item, back] = await markdownToBlocks(markdown, REFS_ON);
    expect(refsIn(paragraph!.content)).toEqual([USER, PAGE, TASK]);
    expect(blocksToPlainText([paragraph])).toBe("Hi @kiran see Roadmap and Ship it");
    expect(item!.type).toBe("bulletListItem");
    expect(refsIn(item!.content)).toEqual([USER, PAGE, TASK]);
    expect(refsIn(cellContent(back, 1, 0))).toEqual([USER]);
    expect(refsIn(cellContent(back, 1, 1))).toEqual([PAGE, TASK]);
  });

  it("keeps a mention nested under a list item", async () => {
    const parent: DocBlock = {
      id: crypto.randomUUID(),
      type: "bulletListItem",
      props: { ...BASE },
      content: [text("Parent")],
      children: [{ id: crypto.randomUUID(), type: "bulletListItem", props: { ...BASE }, content: [text("cc "), USER], children: [] }],
    };
    const [item] = await markdownToBlocks(await blocksToMarkdown([parent], REFS_ON), REFS_ON);
    expect(refsIn(item!.children[0]!.content)).toEqual([USER]);
  });

  it("exports a mention with no id as plain text", async () => {
    const markdown = await blocksToMarkdown(
      [para([{ type: "mention", props: { id: "", label: "ghost" } }, text(" "), { type: "pageMention", props: { pageId: "", label: "Gone" } }])],
      REFS_ON,
    );
    expect(markdown.trim()).toBe("@ghost Gone");
  });

  it("gives an untitled page mention a label", async () => {
    const markdown = await blocksToMarkdown([para([{ type: "pageMention", props: { pageId: "p9", label: "" } }])], REFS_ON);
    const [block] = await markdownToBlocks(markdown, REFS_ON);
    expect(refsIn(block!.content)).toEqual([{ type: "pageMention", props: { pageId: "p9", label: "Untitled" } }]);
  });

  it.each(["Phase 1]", "Q3 *draft*", "`code` notes", "a\\b [x] <tag> _u_ > end", "snake_case_name"])(
    "round-trips the label %s exactly",
    async (label) => {
      const refs = [
        { type: "mention", props: { id: "u1", label } },
        { type: "pageMention", props: { pageId: "p1", label } },
        { type: "taskMention", props: { taskId: "t1", projectId: "pr1", label } },
      ];
      const blocks = [para([refs[0]!, text(" "), refs[1]!, text(" "), refs[2]!]), table([[[text("A")]], [[refs[0]!, text(" "), refs[1]!]]])];
      const markdown = await blocksToMarkdown(blocks, REFS_ON);
      const [paragraph, grid] = await markdownToBlocks(markdown, REFS_ON);
      expect(refsIn(paragraph!.content)).toEqual(refs);
      expect(refsIn(cellContent(grid, 1, 0))).toEqual(refs.slice(0, 2));
    },
  );

  it("leaves mention HTML exports unchanged", async () => {
    const blocks: DocBlock[] = [{ id: "a", type: "paragraph", props: { ...BASE }, content: mixed, children: [] }];
    const inline =
      'Hi <span data-mention-id="u1" data-inline-content-type="mention" data-id="u1" data-label="kiran">@kiran</span>' +
      ' see <span data-page-mention-id="p1" data-inline-content-type="pageMention" data-page-id="p1" data-label="Roadmap">Roadmap</span>' +
      ' and <a data-task-mention-id="t1" href="/projects/pr1?tab=progress&amp;task=t1" data-inline-content-type="taskMention" data-task-id="t1" data-label="Ship it" data-project-id="pr1">Ship it</a>';
    expect(await blocksToHtml(blocks)).toBe(`<p>${inline}</p>`);
    expect(await blocksToFullHtml(blocks)).toBe(
      '<div class="bn-block-group" data-node-type="blockGroup"><div class="bn-block-outer" data-node-type="blockOuter" data-id="a">' +
        '<div class="bn-block" data-node-type="blockContainer" data-id="a"><div class="bn-block-content" data-content-type="paragraph">' +
        `<p class="bn-inline-content">${inline}</p></div></div></div></div>`,
    );
  });

  describe("links that become mentions on parse", () => {
    const parseInline = async (markdown: string) => (await markdownToBlocks(markdown, REFS_ON))[0]!.content as DocInline[];

    it.each([
      ["[@kiran](/members/u_1-A)", { type: "mention", props: { id: "u_1-A", label: "kiran" } }],
      ["[Roadmap](/documents/p1)", { type: "pageMention", props: { pageId: "p1", label: "Roadmap" } }],
      ["[Ship it](/projects/pr1?tab=progress&task=t1)", { type: "taskMention", props: { taskId: "t1", projectId: "pr1", label: "Ship it" } }],
    ])("%s", async (markdown, node) => {
      expect(await parseInline(markdown)).toEqual([node]);
    });

    it.each([
      ["a member link without @", "[kiran](/members/u1)"],
      ["styled link text", "[**@kiran**](/members/u1)"],
      ["link text in two runs", "[@kiran *x*](/members/u1)"],
      ["an extra query string", "[Roadmap](/documents/p1?x=1)"],
      ["an extra task query param", "[Ship it](/projects/pr1?tab=progress&task=t1&x=1)"],
      ["another task tab", "[Ship it](/projects/pr1?tab=board&task=t1)"],
      ["an absolute URL", "[@kiran](https://dali.example/members/u1)"],
      ["a deeper path", "[Roadmap](/documents/p1/export)"],
      ["an id with odd characters", "[Roadmap](/documents/p.1)"],
    ])("leaves %s as a link", async (_name, markdown) => {
      const inlines = await parseInline(markdown);
      expect(inlines[0]!.type).toBe("link");
      expect(refsIn(inlines)).toEqual([]);
    });

    it("converts links inside table cells and nested blocks", async () => {
      const [list, grid] = await markdownToBlocks(
        "- Parent\n\n  - [@kiran](/members/u1)\n\n| A |\n| - |\n| [Roadmap](/documents/p1) |\n",
        REFS_ON,
      );
      expect(refsIn(list!.children[0]!.content)).toEqual([{ type: "mention", props: { id: "u1", label: "kiran" } }]);
      expect(refsIn(cellContent(grid, 1, 0))).toEqual([{ type: "pageMention", props: { pageId: "p1", label: "Roadmap" } }]);
    });
  });

  describe("line breaks in table cells", () => {
    it.each([{}, REFS_ON])("export as <br> and parse back to the same line break (%o)", async (options) => {
      const blocks = [
        table([
          [[text("A")], [text("B")]],
          [[{ type: "text", text: "one\ntwo", styles: { bold: true } }], [text("x\ny\nz")]],
        ]),
      ];
      const markdown = await blocksToMarkdown(blocks, options);
      expect(markdown).toMatch(/^\| \*\*one<br>two\*\* \| x<br>y<br>z +\|$/m);
      expect(markdown).not.toContain("");
      const [back] = await markdownToBlocks(markdown, options);
      expect(back!.type).toBe("table");
      expect((back!.content as DocTableContent).rows).toHaveLength(2);
      expect(cellContent(back, 1, 0)).toEqual([{ type: "text", text: "one\ntwo", styles: { bold: true } }]);
      expect(cellContent(back, 1, 1)).toEqual([text("x\ny\nz")]);
    });

    it("handles a break inside a link in a bare-array cell", async () => {
      const block = table([[[text("A")]], [[text("placeholder")]]]);
      (block.content as DocTableContent).rows[1]!.cells[0] = [
        { type: "link", href: "https://example.com", content: [text("a\nb")] },
      ];
      expect(await blocksToMarkdown([block])).toContain("[a<br>b](https://example.com)");
    });

    it.each([{}, REFS_ON])("keeps the row whole when a mention label in a cell has a line break (%o)", async (options) => {
      const block = table([
        [[text("A")], [text("B")]],
        [[{ type: "mention", props: { id: "u1", label: "two\nlines" } }], [{ type: "pageMention", props: { pageId: "p1", label: "Road\nmap" } }]],
      ]);
      const markdown = await blocksToMarkdown([block], options);
      expect(markdown.trim().split("\n")).toHaveLength(3);
      expect(markdown).toContain("@two lines");
      expect(markdown).toContain("Road map");
      const [back] = await markdownToBlocks(markdown, options);
      expect((back!.content as DocTableContent).rows).toHaveLength(2);
    });

    it("drops a stray placeholder character instead of turning it into a break", async () => {
      const markdown = await blocksToMarkdown([
        para([text("oddchar")]),
        table([[[text("A")]], [[text("incell")]]]),
      ]);
      expect(markdown).not.toContain("<br>");
      expect(markdown).not.toContain("");
      expect(markdown).toContain("oddchar");
      expect(markdown).toContain("incell");
    });

    it("pins how a code-styled cell with a break exports", async () => {
      const block = table([[[text("A")]], [[{ type: "text", text: "a\nb", styles: { code: true } }]]]);
      const markdown = await blocksToMarkdown([block]);
      expect(markdown).toMatch(/^\| `a<br>b` +\|$/m);
      const [back] = await markdownToBlocks(markdown);
      expect(cellContent(back, 1, 0)).toEqual([{ type: "text", text: "a<br>b", styles: { code: true } }]);
    });

    it("leaves line breaks outside tables alone", async () => {
      const markdown = await blocksToMarkdown([para([text("one\ntwo")])]);
      expect(markdown).not.toContain("<br>");
      expect(markdown).toContain("one\\\ntwo");
    });
  });
});

describe("image markdown export", () => {
  const image = (props: Record<string, unknown>): DocBlock =>
    ({ id: crypto.randomUUID(), type: "image", props: { ...BASE, ...props }, children: [] }) as unknown as DocBlock;
  const roundTrip = async (props: Record<string, unknown>) =>
    (await markdownToBlocks(await blocksToMarkdown([image(props)])))[0]!;

  it("writes a name with brackets so the image comes back as an image", async () => {
    const block = await roundTrip({ url: "https://ex.com/a.png", name: "a] b [c" });
    expect(block).toMatchObject({ type: "image", props: { url: "https://ex.com/a.png", name: "a) b (c" } });
  });

  it("writes a link with spaces and parentheses in angle brackets", async () => {
    const markdown = await blocksToMarkdown([image({ url: "https://ex.com/a (1).png", name: "a" })]);
    expect(markdown).toBe("![a](<https://ex.com/a (1).png>)\n");
    const block = await roundTrip({ url: "https://ex.com/a (1).png", name: "a" });
    expect(block).toMatchObject({ type: "image", props: { url: "https://ex.com/a%20(1).png", name: "a" } });
  });

  it("writes a resized image as an img tag with its width", async () => {
    const markdown = await blocksToMarkdown([image({ url: "https://ex.com/a.png?x=1&y=2", name: "chart", previewWidth: 200 })]);
    expect(markdown).toBe('<img src="https://ex.com/a.png?x=1&amp;y=2" alt="chart" width="200">\n');
    const block = await roundTrip({ url: "https://ex.com/a.png?x=1&y=2", name: "chart", previewWidth: 200 });
    expect(block).toMatchObject({ type: "image", props: { url: "https://ex.com/a.png?x=1&y=2", name: "chart", previewWidth: 200 } });
  });

  it("leaves an unresized image with a plain link as ordinary Markdown", async () => {
    expect(await blocksToMarkdown([image({ url: "/api/upload/raw?key=uploads%2Fa.png", name: "chart.png" })])).toBe(
      "![chart.png](/api/upload/raw?key=uploads%2Fa.png)\n",
    );
  });
});
