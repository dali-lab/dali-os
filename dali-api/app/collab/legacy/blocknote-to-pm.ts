// BlockNote block JSON → LEGACY ProseMirror JSON (the old Tiptap dialect).
// Compatibility shim for read paths outside this migration's file ownership
// (education material pages, assignment instructions, portal viewers) that
// still consume `collabDocToProseMirror` and render legacy PM JSON. Once every
// surface renders blocks directly this module loses its callers.
//
// Read-only fidelity is the bar: visible content, marks, and structure must
// survive; editor-grade details (block ids, BlockNote-only props) may not.

import type { DocBlock, DocInline, DocTableCell } from "../blocknote-server";
import type { PMNode } from "../export-html";
import {
  SIGNING_FIELD_TYPES,
} from "~/components/doc/schema/configs";

type PMMark = NonNullable<PMNode["marks"]>[number];

function isSigningField(type: string): boolean {
  return (SIGNING_FIELD_TYPES as readonly string[]).includes(type);
}

function marksForStyles(styles: Record<string, unknown> | undefined): PMMark[] {
  const marks: PMMark[] = [];
  for (const [key, value] of Object.entries(styles ?? {})) {
    if (!value) continue;
    switch (key) {
      case "bold":
      case "italic":
      case "underline":
      case "strike":
      case "code":
        marks.push({ type: key });
        break;
      case "textColor":
        if (value !== "default") marks.push({ type: "textStyle", attrs: { color: value } });
        break;
      case "backgroundColor":
        if (value !== "default") marks.push({ type: "highlight", attrs: { color: value } });
        break;
      default:
        break;
    }
  }
  return marks;
}

function textRuns(text: string, marks: PMMark[]): PMNode[] {
  // "\n" inside a run is BlockNote's soft break — legacy PM uses hardBreak.
  const parts = text.split("\n");
  const out: PMNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push({ type: "hardBreak" });
    if (part) {
      out.push(marks.length ? { type: "text", text: part, marks } : { type: "text", text: part });
    }
  });
  return out;
}

function inlineToPm(content: DocInline[] | undefined): PMNode[] {
  const out: PMNode[] = [];
  for (const inline of content ?? []) {
    switch (inline.type) {
      case "text":
        out.push(...textRuns(inline.text ?? "", marksForStyles(inline.styles)));
        break;
      case "link": {
        const linkMark: PMMark = { type: "link", attrs: { href: inline.href ?? "" } };
        for (const child of inline.content ?? []) {
          if (child.type === "text") {
            out.push(
              ...textRuns(child.text ?? "", [...marksForStyles(child.styles), linkMark]),
            );
          }
        }
        break;
      }
      case "mention":
        out.push({ type: "mention", attrs: { ...(inline.props ?? {}) } });
        break;
      case "variable":
        out.push({ type: "variable", attrs: { ...(inline.props ?? {}) } });
        break;
      default:
        if (isSigningField(inline.type)) {
          out.push({ type: inline.type, attrs: { ...(inline.props ?? {}) } });
        } else if (typeof inline.text === "string") {
          out.push(...textRuns(inline.text, []));
        }
        break;
    }
  }
  return out;
}

function paragraphOf(content: DocInline[] | undefined): PMNode {
  const inline = inlineToPm(content);
  return inline.length ? { type: "paragraph", content: inline } : { type: "paragraph" };
}

function inlineArray(block: DocBlock): DocInline[] | undefined {
  return Array.isArray(block.content) ? (block.content as DocInline[]) : undefined;
}

function cellToPm(cell: DocTableCell | DocInline[], tag: "tableCell" | "tableHeader"): PMNode {
  const content = Array.isArray(cell) ? cell : cell.content;
  const attrs = Array.isArray(cell) ? {} : { ...(cell.props ?? {}) };
  return { type: tag, attrs, content: [paragraphOf(content)] };
}

function tableToPm(block: DocBlock): PMNode {
  const content = block.content as
    | { rows?: { cells?: (DocTableCell | DocInline[])[] }[]; headerRows?: number }
    | undefined;
  const headerRows = content?.headerRows ?? 0;
  return {
    type: "table",
    content: (content?.rows ?? []).map((row, i) => ({
      type: "tableRow",
      content: (row.cells ?? []).map((cell) =>
        cellToPm(cell, i < headerRows ? "tableHeader" : "tableCell"),
      ),
    })),
  };
}

// Group consecutive same-type list-item blocks into one legacy list container.
function blocksToPmNodes(blocks: DocBlock[]): PMNode[] {
  const out: PMNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i]!;
    if (block.type === "bulletListItem" || block.type === "numberedListItem") {
      const type = block.type;
      const items: PMNode[] = [];
      const start = type === "numberedListItem" ? Number(block.props?.start ?? 1) || 1 : 1;
      while (i < blocks.length && blocks[i]!.type === type) {
        const item = blocks[i]!;
        items.push({
          type: "listItem",
          content: [paragraphOf(inlineArray(item)), ...blocksToPmNodes(item.children)],
        });
        i++;
      }
      out.push(
        type === "bulletListItem"
          ? { type: "bulletList", content: items }
          : { type: "orderedList", attrs: { start }, content: items },
      );
      continue;
    }
    if (block.type === "checkListItem") {
      const items: PMNode[] = [];
      while (i < blocks.length && blocks[i]!.type === "checkListItem") {
        const item = blocks[i]!;
        items.push({
          type: "taskItem",
          attrs: { checked: item.props?.checked === true },
          content: [paragraphOf(inlineArray(item)), ...blocksToPmNodes(item.children)],
        });
        i++;
      }
      out.push({ type: "taskList", content: items });
      continue;
    }
    out.push(...blockToPm(block));
    i++;
  }
  return out;
}

function blockToPm(block: DocBlock): PMNode[] {
  const children = blocksToPmNodes(block.children ?? []);
  switch (block.type) {
    case "paragraph": {
      const para = paragraphOf(inlineArray(block));
      return [para, ...children];
    }
    case "heading": {
      const level = Math.min(Math.max(Number(block.props?.level ?? 1), 1), 6);
      const inline = inlineToPm(inlineArray(block));
      return [
        { type: "heading", attrs: { level }, ...(inline.length ? { content: inline } : {}) },
        ...children,
      ];
    }
    case "quote":
      return [
        { type: "blockquote", content: [paragraphOf(inlineArray(block)), ...children] },
      ];
    case "codeBlock": {
      const text = Array.isArray(block.content)
        ? (block.content as DocInline[]).map((c) => c.text ?? "").join("")
        : "";
      const language = typeof block.props?.language === "string" ? block.props.language : null;
      return [
        {
          type: "codeBlock",
          attrs: { language },
          ...(text ? { content: [{ type: "text", text }] } : {}),
        },
        ...children,
      ];
    }
    case "divider":
      return [{ type: "horizontalRule" }, ...children];
    case "image": {
      const width = block.props?.previewWidth;
      const align = block.props?.textAlignment;
      return [
        {
          type: "image",
          attrs: {
            src: typeof block.props?.url === "string" ? block.props.url : "",
            alt: typeof block.props?.caption === "string" ? block.props.caption : null,
            title: null,
            ...(typeof width === "number" ? { width } : {}),
            ...(align === "left" || align === "right" || align === "center"
              ? { align }
              : {}),
          },
        },
        ...children,
      ];
    }
    case "toggleListItem":
      return [
        {
          type: "toggleBlock",
          attrs: { open: true },
          content: [
            { type: "toggleSummary", content: inlineToPm(inlineArray(block)) },
            ...(children.length ? children : [{ type: "paragraph" } as PMNode]),
          ],
        },
      ];
    case "callout":
      return [
        {
          type: "callout",
          attrs: {
            emoji: typeof block.props?.emoji === "string" ? block.props.emoji : "💡",
          },
          content: [paragraphOf(inlineArray(block)), ...children],
        },
      ];
    case "table":
      return [tableToPm(block), ...children];
    case "file":
    case "video":
    case "audio": {
      // BlockNote-only media blocks degrade to a link paragraph.
      const url = typeof block.props?.url === "string" ? block.props.url : "";
      const name = typeof block.props?.name === "string" && block.props.name ? block.props.name : url;
      if (!url) return children;
      return [
        {
          type: "paragraph",
          content: [{ type: "text", text: name, marks: [{ type: "link", attrs: { href: url } }] }],
        },
        ...children,
      ];
    }
    default: {
      // Unknown block: render its inline content as a paragraph.
      const para = paragraphOf(inlineArray(block));
      return [para, ...children];
    }
  }
}

/** Convert blocks to a legacy ProseMirror doc (`{type:"doc",content:[...]}`). */
export function blocksToPmDoc(blocks: DocBlock[]): PMNode {
  const content = blocksToPmNodes(blocks);
  return { type: "doc", content };
}
