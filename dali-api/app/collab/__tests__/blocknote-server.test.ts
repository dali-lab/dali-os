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
