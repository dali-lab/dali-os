import * as Y from "yjs";
import type { RichDoc } from "~/components/slides/types";

type Styles = Record<string, boolean>;
type Inline = { type: "text"; text: string; styles: Styles } | { type: "link"; href: string; content: Inline[] };
interface TableData {
  type: "tableContent";
  headerRows?: number;
  rows: Array<{ cells: Array<{ type: "tableCell"; props: Record<string, unknown>; content: Inline[] }> }>;
}
interface Block {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: Inline[] | TableData;
  children: Block[];
}

const MARKS = new Set(["bold", "italic", "underline", "strike", "code"]);

function inlineOf(node: Y.XmlElement): Inline[] {
  const out: Inline[] = [];
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as Array<{ insert: unknown; attributes?: Record<string, unknown> }>) {
        if (typeof op.insert !== "string") continue;
        const attrs = op.attributes ?? {};
        const styles: Styles = {};
        for (const key of Object.keys(attrs)) if (MARKS.has(key)) styles[key] = true;
        const text: Inline = { type: "text", text: op.insert, styles };
        const link = attrs.link as { href?: unknown } | undefined;
        out.push(link && typeof link.href === "string" ? { type: "link", href: link.href, content: [text] } : text);
      }
    } else if (child instanceof Y.XmlElement && child.nodeName === "mention") {
      const label = child.getAttribute("label") ?? child.getAttribute("title") ?? "";
      out.push({ type: "text", text: `@${label}`, styles: {} });
    }
  }
  return out;
}

function tableOf(node: Y.XmlElement): TableData {
  const rows: TableData["rows"] = [];
  let headerRows = 0;
  for (const row of node.toArray()) {
    if (!(row instanceof Y.XmlElement) || row.nodeName !== "tableRow") continue;
    const cells = row.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement);
    const header = cells.length > 0 && cells.every((c) => c.nodeName === "tableHeader");
    if (header && headerRows === rows.length) headerRows++;
    rows.push({
      cells: cells.map((cell) => ({
        type: "tableCell" as const,
        props: {},
        content: cell.toArray().flatMap((p) => (p instanceof Y.XmlElement ? inlineOf(p) : [])),
      })),
    });
  }
  return { type: "tableContent", ...(headerRows ? { headerRows } : {}), rows };
}

function containerToBlock(container: Y.XmlElement): Block | null {
  const kids = container.toArray().filter((n): n is Y.XmlElement => n instanceof Y.XmlElement);
  const content = kids.find((n) => n.nodeName !== "blockGroup");
  if (!content) return null;
  const group = kids.find((n) => n.nodeName === "blockGroup");
  return {
    id: String(container.getAttribute("id") ?? ""),
    type: content.nodeName,
    props: content.getAttributes(),
    content: content.nodeName === "table" ? tableOf(content) : inlineOf(content),
    children: group ? groupBlocks(group) : [],
  };
}

function groupBlocks(group: Y.XmlElement): Block[] {
  const blocks: Block[] = [];
  for (const node of group.toArray()) {
    if (!(node instanceof Y.XmlElement) || node.nodeName !== "blockContainer") continue;
    const block = containerToBlock(node);
    if (block) blocks.push(block);
  }
  return blocks;
}

/** Reads a BlockNote fragment as plain data without an editor, for thumbnails and read-only slides. Never mutates the fragment. */
export function fragmentToRichDoc(fragment: Y.XmlFragment | undefined | null): RichDoc {
  if (!fragment) return [];
  const blocks: Block[] = [];
  for (const node of fragment.toArray()) {
    if (node instanceof Y.XmlElement && node.nodeName === "blockGroup") blocks.push(...groupBlocks(node));
  }
  const trimmed = [...blocks];
  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1];
    if (last.type !== "paragraph" || !Array.isArray(last.content) || last.content.length > 0 || last.children.length > 0) break;
    trimmed.pop();
  }
  return trimmed as unknown as RichDoc;
}
