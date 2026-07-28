import { describe, it, expect } from "vitest";
import { proseMirrorToBlocks } from "~/public-api/lib/pm-to-blocks";
import type { PMNode } from "~/collab/export-html";

function doc(...content: PMNode[]): PMNode {
  return { type: "doc", content };
}
function text(t: string, marks?: PMNode["marks"]): PMNode {
  return { type: "text", text: t, ...(marks ? { marks } : {}) };
}

describe("proseMirrorToBlocks", () => {
  it("maps a paragraph with every mark the editor can apply", () => {
    const blocks = proseMirrorToBlocks(
      doc({
        type: "paragraph",
        content: [
          text("plain "),
          text("bold", [{ type: "bold" }]),
          text("italic", [{ type: "italic" }]),
          text("struck", [{ type: "strike" }]),
          text("under", [{ type: "underline" }]),
          text("code", [{ type: "code" }]),
          text("link", [{ type: "link", attrs: { href: "https://dali.dartmouth.edu" } }]),
        ],
      }),
    );

    expect(blocks).toHaveLength(1);
    const runs = (blocks[0] as any).paragraph.rich_text;
    expect(runs.map((r: any) => r.plain_text)).toEqual([
      "plain ", "bold", "italic", "struck", "under", "code", "link",
    ]);
    expect(runs[1].annotations.bold).toBe(true);
    expect(runs[2].annotations.italic).toBe(true);
    expect(runs[3].annotations.strikethrough).toBe(true);
    expect(runs[4].annotations.underline).toBe(true);
    expect(runs[5].annotations.code).toBe(true);
    expect(runs[6].text.link).toEqual({ url: "https://dali.dartmouth.edu" });
    expect(runs[0].text.link).toBeNull();
  });

  it("clamps headings to Notion's heading_1..3 vocabulary", () => {
    const blocks = proseMirrorToBlocks(
      doc(
        { type: "heading", attrs: { level: 1 }, content: [text("One")] },
        { type: "heading", attrs: { level: 3 }, content: [text("Three")] },
        // StarterKit allows h4-h6; the renderer only knows three levels, so a
        // deeper heading must clamp rather than vanish.
        { type: "heading", attrs: { level: 6 }, content: [text("Six")] },
      ),
    );
    expect(blocks.map((b) => b.type)).toEqual(["heading_1", "heading_3", "heading_3"]);
    expect((blocks[2] as any).heading_3.rich_text[0].plain_text).toBe("Six");
  });

  it("flattens lists into per-item blocks", () => {
    const item = (t: string): PMNode => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [text(t)] }],
    });
    const blocks = proseMirrorToBlocks(
      doc(
        { type: "bulletList", content: [item("a"), item("b")] },
        { type: "orderedList", content: [item("1")] },
      ),
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "bulleted_list_item",
      "bulleted_list_item",
      "numbered_list_item",
    ]);
    expect((blocks[0] as any).bulleted_list_item.rich_text[0].plain_text).toBe("a");
  });

  it("maps quote, code, and divider", () => {
    const blocks = proseMirrorToBlocks(
      doc(
        { type: "blockquote", content: [{ type: "paragraph", content: [text("quoted")] }] },
        { type: "codeBlock", attrs: { language: "ts" }, content: [text("const x = 1")] },
        { type: "horizontalRule" },
      ),
    );
    expect(blocks.map((b) => b.type)).toEqual(["quote", "code", "divider"]);
    expect((blocks[1] as any).code.language).toBe("ts");
    expect((blocks[1] as any).code.rich_text[0].plain_text).toBe("const x = 1");
  });

  it("renders mentions as their handle instead of dropping the name", () => {
    const blocks = proseMirrorToBlocks(
      doc({
        type: "paragraph",
        content: [text("built by "), { type: "mention", attrs: { id: "u1", label: "spark" } }],
      }),
    );
    const runs = (blocks[0] as any).paragraph.rich_text;
    expect(runs.map((r: any) => r.plain_text).join("")).toBe("built by @spark");
  });

  it("drops empty paragraphs, which are editor spacing rather than content", () => {
    const blocks = proseMirrorToBlocks(
      doc(
        { type: "paragraph", content: [text("real")] },
        { type: "paragraph" },
        { type: "paragraph", content: [] },
      ),
    );
    expect(blocks).toHaveLength(1);
  });

  it("emits children of an unknown block rather than losing its content", () => {
    const blocks = proseMirrorToBlocks(
      doc({
        type: "someFutureExtension",
        content: [{ type: "paragraph", content: [text("still here")] }],
      }),
    );
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as any).paragraph.rich_text[0].plain_text).toBe("still here");
  });

  it("gives every block a distinct id for use as a render key", () => {
    const blocks = proseMirrorToBlocks(
      doc(
        { type: "paragraph", content: [text("a")] },
        { type: "paragraph", content: [text("b")] },
        { type: "horizontalRule" },
      ),
    );
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });

  it("returns an empty array for a never-opened document", () => {
    expect(proseMirrorToBlocks({ type: "doc", content: [] })).toEqual([]);
    expect(proseMirrorToBlocks({ type: "doc" })).toEqual([]);
  });
});
