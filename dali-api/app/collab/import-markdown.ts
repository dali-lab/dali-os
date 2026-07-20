// Pure Markdown → ProseMirror-JSON parsing. The mirror of export-markdown.ts:
// covers the same StarterKit node/mark set (headings, lists, quotes, code,
// links, strike) plus block images, so read_page → edit → set_page_content
// round-trips. No DB import so it's unit-testable. Blocks outside the set
// (tables, raw HTML) degrade to plain-text paragraphs rather than being
// dropped.

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import type { PhrasingContent, RootContent } from "mdast";
import type { PMNode } from "./export-html";

type PMMark = NonNullable<PMNode["marks"]>[number];

function text(value: string, marks: PMMark[]): PMNode {
  return marks.length ? { type: "text", text: value, marks } : { type: "text", text: value };
}

function imageNode(node: { url: string; alt?: string | null; title?: string | null }): PMNode {
  return {
    type: "image",
    attrs: { src: node.url, alt: node.alt ?? null, title: node.title ?? null },
  };
}

// Convert phrasing (inline) content to text runs, accumulating marks as we
// descend. Images are block-level in the Tiptap schema, so any encountered
// inline are hoisted into `images` for the caller to emit as siblings.
function inline(nodes: PhrasingContent[], marks: PMMark[], images: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        if (n.value) out.push(text(n.value, marks));
        break;
      case "emphasis":
        out.push(...inline(n.children, [...marks, { type: "italic" }], images));
        break;
      case "strong":
        out.push(...inline(n.children, [...marks, { type: "bold" }], images));
        break;
      case "delete":
        out.push(...inline(n.children, [...marks, { type: "strike" }], images));
        break;
      case "inlineCode":
        if (n.value) out.push(text(n.value, [...marks, { type: "code" }]));
        break;
      case "link":
        out.push(...inline(n.children, [...marks, { type: "link", attrs: { href: n.url } }], images));
        break;
      case "image":
        images.push(imageNode(n));
        break;
      case "break":
        out.push({ type: "hardBreak" });
        break;
      case "html":
        // Inline HTML has no schema node — keep the source text.
        if (n.value) out.push(text(n.value, marks));
        break;
      default: {
        const u = n as { children?: PhrasingContent[]; value?: string };
        if (u.children) out.push(...inline(u.children, marks, images));
        else if (u.value) out.push(text(u.value, marks));
      }
    }
  }
  return out;
}

// A paragraph's children become paragraph runs interleaved with hoisted block
// images, preserving order for the common standalone-image-paragraph case.
function paragraphBlocks(children: PhrasingContent[]): PMNode[] {
  const blocks: PMNode[] = [];
  let run: PMNode[] = [];
  const flush = () => {
    if (run.length) blocks.push({ type: "paragraph", content: run });
    run = [];
  };
  for (const child of children) {
    if (child.type === "image") {
      flush();
      blocks.push(imageNode(child));
      continue;
    }
    const nested: PMNode[] = [];
    run.push(...inline([child], [], nested));
    if (nested.length) {
      flush();
      blocks.push(...nested);
    }
  }
  flush();
  return blocks;
}

function listItemBlocks(children: RootContent[]): PMNode[] {
  const blocks = children.flatMap(block);
  // Tiptap listItem content is "paragraph block*" — an item may not be empty.
  return blocks.length ? blocks : [{ type: "paragraph" }];
}

function block(node: RootContent): PMNode[] {
  switch (node.type) {
    case "paragraph":
      return paragraphBlocks(node.children);
    case "heading": {
      const images: PMNode[] = [];
      const content = inline(node.children, [], images);
      const heading: PMNode = {
        type: "heading",
        attrs: { level: Math.min(Math.max(node.depth, 1), 6) },
        ...(content.length ? { content } : {}),
      };
      return [heading, ...images];
    }
    case "blockquote": {
      const content = node.children.flatMap(block);
      return [{ type: "blockquote", content: content.length ? content : [{ type: "paragraph" }] }];
    }
    case "list": {
      const items: PMNode[] = node.children.map((li) => ({
        type: "listItem",
        content: listItemBlocks(li.children),
      }));
      if (node.ordered) {
        return [{ type: "orderedList", attrs: { start: node.start ?? 1 }, content: items }];
      }
      return [{ type: "bulletList", content: items }];
    }
    case "code":
      return [
        {
          type: "codeBlock",
          attrs: { language: node.lang ?? null },
          ...(node.value ? { content: [{ type: "text", text: node.value }] } : {}),
        },
      ];
    case "thematicBreak":
      return [{ type: "horizontalRule" }];
    case "html":
      // Block HTML has no schema node — keep the source visible as plain text.
      return node.value.trim()
        ? [{ type: "paragraph", content: [{ type: "text", text: node.value }] }]
        : [];
    default: {
      // Unknown block (tables, definitions, …) → flatten children so content
      // is never dropped silently, matching the export renderers' fallback.
      const u = node as { children?: RootContent[]; value?: string };
      if (u.children) return u.children.flatMap(block);
      if (u.value?.trim()) {
        return [{ type: "paragraph", content: [{ type: "text", text: u.value }] }];
      }
      return [];
    }
  }
}

export function markdownToProseMirror(markdown: string): PMNode {
  const tree = fromMarkdown(markdown, {
    extensions: [gfmStrikethrough()],
    mdastExtensions: [gfmStrikethroughFromMarkdown()],
  });
  const content = tree.children.flatMap(block);
  // A ProseMirror doc requires at least one block ("block+").
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
