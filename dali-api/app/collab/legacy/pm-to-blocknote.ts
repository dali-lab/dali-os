// TOTAL legacy ProseMirror JSON → BlockNote block JSON mapper. "Total" means
// every node the old Tiptap schema could produce maps to SOMETHING — unknown
// nodes degrade to a paragraph carrying their extracted text, never to silent
// drops. Pure (no DB, no editor import) so it's unit-testable and usable from
// the batch sweep script.
//
// Prod census this covers 1:1: paragraph/heading/lists/hardBreak/
// image(align,width)/link/bold/italic/underline/highlight/mention, toggleBlock,
// table, plus the JSON-column-only signing field nodes + variable, and the
// full remaining schema set (taskList, blockquote, codeBlock, callout,
// horizontalRule, strike, code, textStyle color) even where prod count is zero.
//
// Losses (dropped or approximated data) are collected as human-readable
// strings for the caller to log — conversion never throws on shape surprises.

import { randomUUID } from "node:crypto";
import {
  SIGNING_FIELD_TYPES,
  type SigningFieldType,
} from "~/components/doc/schema/configs";
import type {
  DocBlock,
  DocInline,
  DocTableCell,
  DocTableContent,
} from "../blocknote-server";
import type { PMNode } from "../export-html";

const BASE_TEXT_PROPS = {
  backgroundColor: "default",
  textColor: "default",
  textAlignment: "left",
} as const;

interface MapContext {
  losses: string[];
}

function newId(): string {
  return randomUUID();
}

function isSigningField(type: string): type is SigningFieldType {
  return (SIGNING_FIELD_TYPES as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// Inline content

function styleForMarks(marks: PMNode["marks"], ctx: MapContext): {
  styles: Record<string, unknown>;
  linkHref: string | null;
} {
  const styles: Record<string, unknown> = {};
  let linkHref: string | null = null;
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
      case "italic":
      case "underline":
      case "strike":
      case "code":
        styles[mark.type] = true;
        break;
      case "textStyle": {
        const color = mark.attrs?.color;
        if (typeof color === "string" && color) styles.textColor = color;
        break;
      }
      case "highlight": {
        const color = mark.attrs?.color;
        styles.backgroundColor = typeof color === "string" && color ? color : "yellow";
        break;
      }
      case "link": {
        const href = mark.attrs?.href;
        if (typeof href === "string" && href) linkHref = href;
        break;
      }
      default:
        ctx.losses.push(`dropped unknown mark "${mark.type}"`);
        break;
    }
  }
  return { styles, linkHref };
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

// Convert inline-level PM nodes (text / hardBreak / mention / signing atoms /
// variable) to BlockNote inline content. hardBreak becomes "\n" — BlockNote's
// in-text soft-break form.
function mapInline(nodes: PMNode[] | undefined, ctx: MapContext): DocInline[] {
  const out: DocInline[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "text": {
        const { styles, linkHref } = styleForMarks(node.marks, ctx);
        const run: DocInline = { type: "text", text: node.text ?? "", styles };
        if (linkHref) {
          out.push({ type: "link", href: linkHref, content: [run] });
        } else {
          out.push(run);
        }
        break;
      }
      case "hardBreak": {
        // Append to the previous plain-text run when possible so consecutive
        // text isn't fragmented; otherwise emit a bare newline run.
        const prev = out[out.length - 1];
        if (prev && prev.type === "text") prev.text = `${prev.text ?? ""}\n`;
        else out.push({ type: "text", text: "\n", styles: {} });
        break;
      }
      case "mention":
        out.push({
          type: "mention",
          props: {
            id: str(node.attrs?.id),
            label: str(node.attrs?.label),
          },
        });
        break;
      case "variable":
        out.push({
          type: "variable",
          props: {
            name: str(node.attrs?.name),
            value: str(node.attrs?.value),
          },
        });
        break;
      default: {
        if (isSigningField(node.type)) {
          out.push({
            type: node.type,
            props: {
              fieldId: str(node.attrs?.fieldId),
              role: str(node.attrs?.role),
              label: str(node.attrs?.label),
              placeholder: str(node.attrs?.placeholder),
              value:
                node.attrs?.value === true || node.attrs?.value === false
                  ? String(node.attrs.value)
                  : str(node.attrs?.value),
              required: node.attrs?.required !== false,
            },
          });
          break;
        }
        // Unknown inline node: keep its text so words never vanish.
        const text = extractText(node);
        if (text) out.push({ type: "text", text, styles: {} });
        ctx.losses.push(`flattened unknown inline node "${node.type}" to text`);
        break;
      }
    }
  }
  return out;
}

// Concatenate all text under a node (for unknown-node fallbacks).
function extractText(node: PMNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(extractText).join("");
}

// ---------------------------------------------------------------------------
// Blocks

function textBlock(
  type: string,
  content: DocInline[],
  children: DocBlock[],
  extraProps: Record<string, unknown> = {},
): DocBlock {
  return {
    id: newId(),
    type,
    props: { ...BASE_TEXT_PROPS, ...extraProps },
    content,
    children,
  };
}

// A container's first inline-capable child becomes the container's own inline
// content; everything else becomes children. Used by callout / quote / toggle,
// whose BlockNote form is inline-content + child blocks.
function splitLead(
  children: PMNode[] | undefined,
  ctx: MapContext,
): { lead: DocInline[]; rest: DocBlock[] } {
  const nodes = children ?? [];
  if (nodes[0]?.type === "paragraph") {
    return {
      lead: mapInline(nodes[0].content, ctx),
      rest: nodes.slice(1).flatMap((n) => mapBlock(n, ctx)),
    };
  }
  return { lead: [], rest: nodes.flatMap((n) => mapBlock(n, ctx)) };
}

function mapListItems(
  items: PMNode[] | undefined,
  itemType: "bulletListItem" | "numberedListItem",
  ctx: MapContext,
): DocBlock[] {
  return (items ?? []).flatMap((item) => {
    if (item.type !== "listItem") {
      ctx.losses.push(`unexpected "${item.type}" inside a list — mapped as block`);
      return mapBlock(item, ctx);
    }
    // Tiptap listItem content is "paragraph block*": the first paragraph is
    // the item's own line; nested lists / further blocks become children.
    const children = item.content ?? [];
    const first = children[0];
    let content: DocInline[] = [];
    let restNodes = children;
    if (first?.type === "paragraph") {
      content = mapInline(first.content, ctx);
      restNodes = children.slice(1);
    }
    return [
      {
        id: newId(),
        type: itemType,
        props: { ...BASE_TEXT_PROPS },
        content,
        children: restNodes.flatMap((n) => mapBlock(n, ctx)),
      },
    ];
  });
}

function mapTaskItems(items: PMNode[] | undefined, ctx: MapContext): DocBlock[] {
  return (items ?? []).flatMap((item) => {
    if (item.type !== "taskItem") {
      ctx.losses.push(`unexpected "${item.type}" inside a taskList — mapped as block`);
      return mapBlock(item, ctx);
    }
    const children = item.content ?? [];
    const first = children[0];
    let content: DocInline[] = [];
    let restNodes = children;
    if (first?.type === "paragraph") {
      content = mapInline(first.content, ctx);
      restNodes = children.slice(1);
    }
    return [
      {
        id: newId(),
        type: "checkListItem",
        props: { ...BASE_TEXT_PROPS, checked: item.attrs?.checked === true },
        content,
        children: restNodes.flatMap((n) => mapBlock(n, ctx)),
      },
    ];
  });
}

function cellInline(cell: PMNode, ctx: MapContext): DocInline[] {
  // Table cells hold paragraph(s); BlockNote cells hold one inline run. Join
  // multi-paragraph cells with newlines.
  const paras = (cell.content ?? []).map((child) =>
    child.type === "paragraph"
      ? mapInline(child.content, ctx)
      : mapInline([{ type: "text", text: extractText(child) }], ctx),
  );
  const out: DocInline[] = [];
  paras.forEach((runs, i) => {
    if (i > 0) out.push({ type: "text", text: "\n", styles: {} });
    out.push(...runs);
  });
  return out;
}

function mapTable(node: PMNode, ctx: MapContext): DocBlock {
  const rows = (node.content ?? []).filter((r) => r.type === "tableRow");
  const headerRows = rows[0]?.content?.every((c) => c.type === "tableHeader") ? 1 : 0;
  const colCount = Math.max(1, ...rows.map((r) => (r.content ?? []).length));
  const content: DocTableContent = {
    type: "tableContent",
    columnWidths: Array(colCount).fill(undefined),
    ...(headerRows ? { headerRows } : {}),
    rows: rows.map((row) => ({
      cells: (row.content ?? []).map(
        (cell): DocTableCell => ({
          type: "tableCell",
          props: {
            colspan: typeof cell.attrs?.colspan === "number" ? cell.attrs.colspan : 1,
            rowspan: typeof cell.attrs?.rowspan === "number" ? cell.attrs.rowspan : 1,
            backgroundColor: "default",
            textColor: "default",
            textAlignment: "left",
          },
          content: cellInline(cell, ctx),
        }),
      ),
    })),
  };
  return {
    id: newId(),
    type: "table",
    props: { textColor: "default" },
    content,
    children: [],
  };
}

function mapImage(node: PMNode, _ctx: MapContext): DocBlock {
  const align = node.attrs?.align;
  const width = node.attrs?.width;
  return {
    id: newId(),
    type: "image",
    props: {
      backgroundColor: "default",
      textAlignment:
        align === "left" || align === "right" || align === "center"
          ? align
          : "left",
      name: "",
      url: str(node.attrs?.src),
      caption: str(node.attrs?.alt),
      showPreview: true,
      previewWidth: typeof width === "number" && width > 0 ? width : undefined,
    },
    content: undefined,
    children: [],
  };
}

function mapBlock(node: PMNode, ctx: MapContext): DocBlock[] {
  if (node.attrs && node.attrs.lineHeight != null) {
    ctx.losses.push(`dropped lineHeight on "${node.type}"`);
  }
  switch (node.type) {
    case "paragraph":
      return [textBlock("paragraph", mapInline(node.content, ctx), [])];
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return [
        textBlock("heading", mapInline(node.content, ctx), [], {
          level,
          isToggleable: false,
        }),
      ];
    }
    case "bulletList":
      return mapListItems(node.content, "bulletListItem", ctx);
    case "orderedList": {
      const items = mapListItems(node.content, "numberedListItem", ctx);
      const start = Number(node.attrs?.start ?? 1);
      items.forEach((item, i) => {
        if (item.type === "numberedListItem") {
          item.props.start = i === 0 && start !== 1 ? start : undefined;
        }
      });
      return items;
    }
    case "taskList":
      return mapTaskItems(node.content, ctx);
    case "blockquote": {
      const { lead, rest } = splitLead(node.content, ctx);
      return [
        {
          id: newId(),
          type: "quote",
          props: { backgroundColor: "default", textColor: "default" },
          content: lead,
          children: rest,
        },
      ];
    }
    case "codeBlock": {
      const text = (node.content ?? []).map((c) => c.text ?? "").join("");
      return [
        {
          id: newId(),
          type: "codeBlock",
          props: { language: str(node.attrs?.language, "text") || "text" },
          content: text ? [{ type: "text", text, styles: {} }] : [],
          children: [],
        },
      ];
    }
    case "horizontalRule":
      return [{ id: newId(), type: "divider", props: {}, content: undefined, children: [] }];
    case "image":
      return [mapImage(node, ctx)];
    case "toggleBlock": {
      // First child may be a toggleSummary; the rest is the collapsible body.
      const children = node.content ?? [];
      const hasSummary = children[0]?.type === "toggleSummary";
      const summary = hasSummary ? mapInline(children[0]!.content, ctx) : [];
      const body = (hasSummary ? children.slice(1) : children).flatMap((n) =>
        mapBlock(n, ctx),
      );
      return [textBlock("toggleListItem", summary, body)];
    }
    case "toggleSummary":
      // Defensive: a summary outside a toggle renders as its own paragraph.
      return [textBlock("paragraph", mapInline(node.content, ctx), [])];
    case "callout": {
      const { lead, rest } = splitLead(node.content, ctx);
      return [
        {
          id: newId(),
          type: "callout",
          props: { emoji: str(node.attrs?.emoji, "💡") || "💡" },
          content: lead,
          children: rest,
        },
      ];
    }
    case "table":
      return [mapTable(node, ctx)];
    case "hardBreak":
      // Defensive: block-level hardBreak becomes an empty paragraph.
      return [textBlock("paragraph", [], [])];
    default: {
      // Inline atoms reaching block level (schema drift) keep their inline form
      // wrapped in a paragraph.
      if (
        node.type === "text" ||
        node.type === "mention" ||
        node.type === "variable" ||
        isSigningField(node.type)
      ) {
        return [textBlock("paragraph", mapInline([node], ctx), [])];
      }
      // Unknown block: keep the text, log the loss.
      ctx.losses.push(`mapped unknown block "${node.type}" to paragraph text`);
      const text = extractText(node);
      return [
        textBlock(
          "paragraph",
          text ? [{ type: "text", text, styles: {} }] : [],
          [],
        ),
      ];
    }
  }
}

// ---------------------------------------------------------------------------
// Entry points

export interface PmMapResult {
  blocks: DocBlock[];
  losses: string[];
}

/** Map a full legacy ProseMirror doc (`{type:"doc",content:[...]}`) to
 * BlockNote block JSON. Never throws on malformed input — a non-doc value maps
 * to an empty document with a loss entry. */
export function mapPmDocToBlocks(pmJson: unknown): PmMapResult {
  const ctx: MapContext = { losses: [] };
  if (!pmJson || typeof pmJson !== "object") {
    if (pmJson != null) ctx.losses.push("input was not a ProseMirror doc object");
    return { blocks: [], losses: ctx.losses };
  }
  const doc = pmJson as PMNode;
  if (typeof doc.type !== "string" || doc.type === "") {
    // Not a PM node at all (e.g. the `{}` column default) — empty document.
    return { blocks: [], losses: ctx.losses };
  }
  if (doc.type !== "doc") {
    ctx.losses.push(`root node was "${doc.type}" — mapped as a block list`);
    return { blocks: mapBlock(doc, ctx), losses: ctx.losses };
  }
  return { blocks: (doc.content ?? []).flatMap((n) => mapBlock(n, ctx)), losses: ctx.losses };
}

/** Format-sniffing normalizer for JSON columns that may hold either legacy
 * ProseMirror JSON or already-converted block JSON:
 *   - block array → passes through untouched
 *   - `{type:"doc"}` → mapped (losses logged to console)
 *   - null / {} / anything empty → []
 */
export function ensureBlocks(json: unknown): DocBlock[] {
  if (json == null) return [];
  if (Array.isArray(json)) return json as DocBlock[];
  if (typeof json === "object" && (json as { type?: string }).type === "doc") {
    const { blocks, losses } = mapPmDocToBlocks(json);
    if (losses.length > 0) {
      console.warn(`[collab:convert] ensureBlocks losses: ${losses.join("; ")}`);
    }
    return blocks;
  }
  return [];
}
