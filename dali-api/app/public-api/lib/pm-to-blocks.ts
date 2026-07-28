import type { PMNode } from "~/collab/export-html";

// ProseMirror JSON → the block shape dali.website's NotionRenderer already
// draws. The public site was built against Notion's block format; rather than
// rewrite that renderer, the API speaks its dialect, so a project write-up
// authored in the collab editor renders exactly like the Notion content it
// replaces.
//
// Structured blocks rather than the HTML that export-html.ts produces: the
// website would have to inject that with dangerouslySetInnerHTML, and there's
// no reason to open that surface when the renderer on the other side already
// takes data.
//
// Pure (no DB import) so it can be unit-tested directly, same reasoning as
// export-html.ts. The DB-coupled caller is public-project-content.server.ts.

export type PublicRichText = {
  type: "text";
  text: { content: string; link: { url: string } | null };
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
  };
  plain_text: string;
};

export type PublicBlock = {
  id: string;
  type: string;
  [key: string]: unknown;
};

function richText(node: PMNode): PublicRichText | null {
  const content = node.text ?? "";
  if (!content) return null;
  const marks = node.marks ?? [];
  const link = marks.find((m) => m.type === "link");
  const href = typeof link?.attrs?.href === "string" ? link.attrs.href : null;
  return {
    type: "text",
    text: { content, link: href ? { url: href } : null },
    annotations: {
      bold: marks.some((m) => m.type === "bold"),
      italic: marks.some((m) => m.type === "italic"),
      strikethrough: marks.some((m) => m.type === "strike"),
      underline: marks.some((m) => m.type === "underline"),
      code: marks.some((m) => m.type === "code"),
    },
    plain_text: content,
  };
}

// Flatten a block's inline content into rich-text runs. `hardBreak` becomes a
// newline rather than its own run so a soft-wrapped paragraph stays one
// paragraph on the website. Mention nodes render as their stored handle —
// dropping them would silently delete a name from a published write-up.
function inline(nodes: PMNode[] | undefined): PublicRichText[] {
  const out: PublicRichText[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "text") {
      const rt = richText(node);
      if (rt) out.push(rt);
    } else if (node.type === "hardBreak") {
      out.push(plain("\n"));
    } else if (node.type === "mention") {
      const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
      if (label) out.push(plain(`@${label}`));
    } else if (node.content) {
      out.push(...inline(node.content));
    }
  }
  return out;
}

function plain(content: string): PublicRichText {
  return {
    type: "text",
    text: { content, link: null },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
    },
    plain_text: content,
  };
}

// Block ids only have to be stable within one response — the renderer uses
// them as React keys. A positional counter is enough and keeps the mapper pure
// (no crypto/random, so snapshots in tests stay deterministic).
function makeIdGen() {
  let n = 0;
  return () => `b${n++}`;
}

function convert(node: PMNode, id: () => string): PublicBlock[] {
  switch (node.type) {
    case "paragraph": {
      const rich_text = inline(node.content);
      // Empty paragraphs are the editor's line spacing; the website's own
      // block margins already provide that, so they'd render as double gaps.
      if (rich_text.length === 0) return [];
      return [{ id: id(), type: "paragraph", paragraph: { rich_text } }];
    }
    case "heading": {
      // Notion's vocabulary stops at heading_3; deeper levels clamp rather
      // than emitting a type the renderer would silently skip.
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
      const type = `heading_${level}`;
      return [{ id: id(), type, [type]: { rich_text: inline(node.content) } }];
    }
    case "bulletList":
    case "orderedList": {
      const type =
        node.type === "bulletList" ? "bulleted_list_item" : "numbered_list_item";
      // Notion has no list container — each item is a top-level block. Nested
      // lists inside an item are flattened up as siblings; the site renders a
      // flat list either way, so this loses indentation but no content.
      return (node.content ?? []).flatMap((item) => {
        const [first, ...rest] = item.content ?? [];
        const blocks: PublicBlock[] = [
          { id: id(), type, [type]: { rich_text: inline(first ? [first] : []) } },
        ];
        for (const child of rest) blocks.push(...convert(child, id));
        return blocks;
      });
    }
    case "blockquote":
      return [{ id: id(), type: "quote", quote: { rich_text: inline(node.content) } }];
    case "codeBlock":
      return [
        {
          id: id(),
          type: "code",
          code: {
            rich_text: [plain((node.content ?? []).map((c) => c.text ?? "").join(""))],
            language:
              typeof node.attrs?.language === "string" ? node.attrs.language : "plain text",
          },
        },
      ];
    case "horizontalRule":
      return [{ id: id(), type: "divider", divider: {} }];
    default:
      // Unknown block: emit its children rather than dropping content, the
      // same fallback export-html.ts takes.
      return (node.content ?? []).flatMap((c) => convert(c, id));
  }
}

export function proseMirrorToBlocks(doc: PMNode): PublicBlock[] {
  const id = makeIdGen();
  return (doc.content ?? []).flatMap((node) => convert(node, id));
}
