import { describe, it, expect } from "vitest";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { markdownToProseMirror } from "../import-markdown";
import { renderMarkdown } from "../export-markdown";
import { pmJsonToYDoc } from "../pm-to-y";
import type { PMNode } from "../export-html";

describe("markdownToProseMirror", () => {
  it("parses the StarterKit block set", () => {
    const doc = markdownToProseMirror(
      [
        "# Title",
        "",
        "Some **bold** and *italic* and ~~gone~~ and `code`.",
        "",
        "> quoted",
        "",
        "- one",
        "- two",
        "",
        "1. first",
        "2. second",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "---",
      ].join("\n"),
    );

    const types = (doc.content ?? []).map((n) => n.type);
    expect(types).toEqual([
      "heading",
      "paragraph",
      "blockquote",
      "bulletList",
      "orderedList",
      "codeBlock",
      "horizontalRule",
    ]);

    expect(doc.content?.[0]).toMatchObject({ attrs: { level: 1 } });

    const para = doc.content?.[1];
    const markSets = (para?.content ?? []).map((n) => (n.marks ?? []).map((m) => m.type));
    expect(markSets).toContainEqual(["bold"]);
    expect(markSets).toContainEqual(["italic"]);
    expect(markSets).toContainEqual(["strike"]);
    expect(markSets).toContainEqual(["code"]);

    expect(doc.content?.[5]).toMatchObject({
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const x = 1;" }],
    });
  });

  it("parses links as marks with href", () => {
    const doc = markdownToProseMirror("[DALI](https://dali.dartmouth.edu)");
    expect(doc.content?.[0].content?.[0].marks).toEqual([
      { type: "link", attrs: { href: "https://dali.dartmouth.edu" } },
    ]);
  });

  it("lifts a standalone image paragraph to a block image", () => {
    const doc = markdownToProseMirror("![diagram](/api/upload/raw?key=uploads%2Fx)");
    expect(doc.content).toEqual([
      {
        type: "image",
        attrs: { src: "/api/upload/raw?key=uploads%2Fx", alt: "diagram", title: null },
      },
    ]);
  });

  it("splits a paragraph around an inline image, preserving order", () => {
    const doc = markdownToProseMirror("before ![pic](u) after");
    expect((doc.content ?? []).map((n) => n.type)).toEqual([
      "paragraph",
      "image",
      "paragraph",
    ]);
  });

  it("nested lists survive", () => {
    const doc = markdownToProseMirror("- outer\n  - inner");
    const outerItem = doc.content?.[0].content?.[0];
    expect((outerItem?.content ?? []).map((n) => n.type)).toEqual([
      "paragraph",
      "bulletList",
    ]);
  });

  it("hard breaks become hardBreak nodes", () => {
    const doc = markdownToProseMirror("line one  \nline two");
    const types = (doc.content?.[0].content ?? []).map((n) => n.type);
    expect(types).toContain("hardBreak");
  });

  it("empty input yields a single empty paragraph (doc requires block+)", () => {
    expect(markdownToProseMirror("")).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("keeps raw HTML visible as plain text instead of dropping it", () => {
    const doc = markdownToProseMirror("<video src='x'></video>");
    expect(doc.content?.[0].content?.[0].text).toContain("<video");
  });

  it("round-trips through renderMarkdown at the ProseMirror level", () => {
    const markdown = [
      "# Notes",
      "",
      "Plain with **bold** and a [link](https://example.com).",
      "",
      "- alpha",
      "- beta",
      "",
      "![chart](/api/upload/raw?key=uploads%2Fc)",
    ].join("\n");
    const first = markdownToProseMirror(markdown);
    const second = markdownToProseMirror(renderMarkdown(first));
    expect(second).toEqual(first);
  });
});

describe("pmJsonToYDoc", () => {
  it("round-trips the full node set through Yjs", () => {
    const doc = markdownToProseMirror(
      [
        "## Heading",
        "",
        "Body with *emphasis* and `code`.",
        "",
        "1. item",
        "",
        "![img](/u)",
        "",
        "```js",
        "x",
        "```",
      ].join("\n"),
    );
    const ydoc = pmJsonToYDoc(doc);
    const back = yDocToProsemirrorJSON(ydoc, "default") as PMNode;
    ydoc.destroy();
    // Compare via the markdown renderer — Y/PM normalize default attrs, so
    // deep-equality of raw JSON is too strict, but rendered output must match.
    expect(renderMarkdown(back)).toEqual(renderMarkdown(doc));
  });

  it("rejects JSON that doesn't fit the schema", () => {
    expect(() =>
      pmJsonToYDoc({ type: "doc", content: [{ type: "nonsense" }] }),
    ).toThrow();
  });
});
