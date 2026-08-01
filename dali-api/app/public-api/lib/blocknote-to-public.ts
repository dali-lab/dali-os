// BlockNote block JSON → the block shape dali.website's NotionRenderer draws.
// Successor to pm-to-blocks.ts (which speaks the same output dialect from
// legacy ProseMirror JSON): the collab pipeline now reads documents as
// BlockNote blocks (readDocAsBlocks), so the public projects API converts from
// that shape. Same design constraints: structured blocks rather than HTML, and
// pure (no DB import) so it's unit-testable.

import type { DocBlock, DocInline, DocTableCell } from "~/collab/blocknote-server";
import { publicImageSrc, type PublicBlock, type PublicRichText } from "./pm-to-blocks";

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

function styled(content: string, styles: Record<string, unknown>, href: string | null): PublicRichText {
  return {
    type: "text",
    text: { content, link: href ? { url: href } : null },
    annotations: {
      bold: styles.bold === true,
      italic: styles.italic === true,
      strikethrough: styles.strike === true,
      underline: styles.underline === true,
      code: styles.code === true,
    },
    plain_text: content,
  };
}

// Flatten a block's inline content into rich-text runs. Mention nodes render
// as their stored handle — dropping them would silently delete a name from a
// published write-up. Signing atoms never appear on public project pages;
// they degrade to their visible text just in case.
function inline(content: DocInline[] | undefined, href: string | null = null): PublicRichText[] {
  const out: PublicRichText[] = [];
  for (const node of content ?? []) {
    switch (node.type) {
      case "text": {
        const text = node.text ?? "";
        if (text) out.push(styled(text, node.styles ?? {}, href));
        break;
      }
      case "link":
        out.push(...inline(node.content, typeof node.href === "string" ? node.href : null));
        break;
      case "mention": {
        const label = typeof node.props?.label === "string" ? node.props.label : "";
        if (label) out.push(plain(`@${label}`));
        break;
      }
      case "variable": {
        const value = typeof node.props?.value === "string" ? node.props.value : "";
        const name = typeof node.props?.name === "string" ? node.props.name : "";
        out.push(plain(value || `{{${name}}}`));
        break;
      }
      default:
        if (typeof node.text === "string" && node.text) out.push(plain(node.text));
        break;
    }
  }
  return out;
}

function blockInline(block: DocBlock): PublicRichText[] {
  return Array.isArray(block.content) ? inline(block.content as DocInline[]) : [];
}

function makeIdGen() {
  let n = 0;
  return () => `b${n++}`;
}

function cellText(cell: DocTableCell | DocInline[]): string {
  const content = Array.isArray(cell) ? cell : cell.content;
  return inline(content)
    .map((r) => r.plain_text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function convert(block: DocBlock, id: () => string): PublicBlock[] {
  const children = (block.children ?? []).flatMap((child) => convert(child, id));
  switch (block.type) {
    case "paragraph": {
      const rich_text = blockInline(block);
      // Empty paragraphs are the editor's line spacing; the website's own
      // block margins already provide that, so they'd render as double gaps.
      if (rich_text.length === 0) return children;
      return [{ id: id(), type: "paragraph", paragraph: { rich_text } }, ...children];
    }
    case "heading": {
      // Notion's vocabulary stops at heading_3; deeper levels clamp rather
      // than emitting a type the renderer would silently skip.
      const level = Math.min(Math.max(Number(block.props?.level ?? 1), 1), 3);
      const type = `heading_${level}`;
      return [{ id: id(), type, [type]: { rich_text: blockInline(block) } }, ...children];
    }
    case "image": {
      const src = typeof block.props?.url === "string" ? block.props.url : "";
      const url = src ? publicImageSrc(src) : null;
      // A src we can't make publicly reachable is dropped rather than emitted
      // as a broken <img> on the marketing site.
      if (!url) return children;
      const caption = typeof block.props?.caption === "string" ? block.props.caption : "";
      return [
        {
          id: id(),
          type: "image",
          image: { external: { url }, caption: caption ? [plain(caption)] : [] },
        },
        ...children,
      ];
    }
    case "bulletListItem":
    // A public write-up is prose — an unticked checkbox carries no meaning to
    // a visitor, so check lists render as bullets (same call pm-to-blocks
    // made for taskList).
    case "checkListItem":
      return [
        {
          id: id(),
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: blockInline(block) },
        },
        // Nested content is flattened up as siblings; the site renders a flat
        // list either way, so this loses indentation but no content.
        ...children,
      ];
    case "numberedListItem":
      return [
        {
          id: id(),
          type: "numbered_list_item",
          numbered_list_item: { rich_text: blockInline(block) },
        },
        ...children,
      ];
    case "quote":
      return [{ id: id(), type: "quote", quote: { rich_text: blockInline(block) } }, ...children];
    case "callout":
      return [
        {
          id: id(),
          type: "callout",
          callout: {
            rich_text: blockInline(block),
            icon: {
              emoji: typeof block.props?.emoji === "string" ? block.props.emoji : "💡",
            },
          },
        },
        ...children,
      ];
    // A toggle's summary is its visible label and its children are what
    // unfolds. The renderer's `toggle` block only carries the label, so the
    // body is emitted as following blocks — collapsed detail becomes plain
    // prose rather than disappearing.
    case "toggleListItem":
      return [
        { id: id(), type: "toggle", toggle: { rich_text: blockInline(block) } },
        ...children,
      ];
    case "codeBlock": {
      const text = Array.isArray(block.content)
        ? (block.content as DocInline[]).map((c) => c.text ?? "").join("")
        : "";
      return [
        {
          id: id(),
          type: "code",
          code: {
            rich_text: [plain(text)],
            language:
              typeof block.props?.language === "string" && block.props.language
                ? block.props.language
                : "plain text",
          },
        },
        ...children,
      ];
    }
    case "divider":
      return [{ id: id(), type: "divider", divider: {} }, ...children];
    case "table": {
      // The renderer has no table block — emit one paragraph per row so the
      // data stays readable.
      const content = block.content as
        | { rows?: { cells?: (DocTableCell | DocInline[])[] }[] }
        | undefined;
      const rows = (content?.rows ?? [])
        .map((row) => (row.cells ?? []).map(cellText).join("  |  "))
        .filter((line) => line.trim());
      return [
        ...rows.map((line) => ({
          id: id(),
          type: "paragraph",
          paragraph: { rich_text: [plain(line)] },
        })),
        ...children,
      ];
    }
    default: {
      // Unknown block: emit its inline text rather than dropping content.
      const rich_text = blockInline(block);
      if (rich_text.length === 0) return children;
      return [{ id: id(), type: "paragraph", paragraph: { rich_text } }, ...children];
    }
  }
}

export function docBlocksToPublicBlocks(blocks: DocBlock[]): PublicBlock[] {
  const id = makeIdGen();
  return blocks.flatMap((block) => convert(block, id));
}
