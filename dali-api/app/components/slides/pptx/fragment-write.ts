import * as Y from "yjs";
import type { ImportBlock, ImportInline, ImportTable } from "./import-types";

const BASE_ATTRS = { backgroundColor: "default", textColor: "default", textAlignment: "left" } as const;

function textNodes(content: ImportInline[], inherited: Record<string, unknown> = {}): Y.XmlText[] {
  const out: Y.XmlText[] = [];
  for (const inline of content) {
    if (inline.type === "link") {
      out.push(...textNodes(inline.content ?? [], { ...inherited, link: { href: inline.href ?? "" } }));
      continue;
    }
    if (!inline.text) continue;
    const attributes: Record<string, unknown> = { ...inherited };
    for (const [mark, on] of Object.entries(inline.styles ?? {})) if (on) attributes[mark] = {};
    const node = new Y.XmlText();
    node.insert(0, inline.text, attributes);
    out.push(node);
  }
  return out;
}

function tableOf(table: ImportTable): Y.XmlElement {
  const node = new Y.XmlElement("table");
  node.setAttribute("textColor", "default");
  node.insert(
    0,
    table.rows.map((cells, r) => {
      const row = new Y.XmlElement("tableRow");
      row.insert(
        0,
        cells.map((inlines) => {
          const cell = new Y.XmlElement(table.header && r === 0 ? "tableHeader" : "tableCell");
          cell.setAttribute("colspan", 1 as never);
          cell.setAttribute("rowspan", 1 as never);
          const paragraph = new Y.XmlElement("tableParagraph");
          const nodes = textNodes(inlines);
          if (nodes.length) paragraph.insert(0, nodes);
          cell.insert(0, [paragraph]);
          return cell;
        }),
      );
      return row;
    }),
  );
  return node;
}

function containerOf(block: ImportBlock): Y.XmlElement {
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", crypto.randomUUID());
  const content = block.type === "table" && block.table ? tableOf(block.table) : new Y.XmlElement(block.type === "table" ? "paragraph" : block.type);
  if (block.type !== "table") for (const [k, v] of Object.entries(BASE_ATTRS)) content.setAttribute(k, v);
  if (block.type === "codeBlock") content.setAttribute("language", block.language || "text");
  const nodes = block.type === "table" ? [] : textNodes(block.content);
  if (nodes.length) content.insert(0, nodes);
  const parts: Y.XmlElement[] = [content];
  if (block.children.length > 0) parts.push(groupOf(block.children));
  container.insert(0, parts);
  return container;
}

function groupOf(blocks: ImportBlock[]): Y.XmlElement {
  const group = new Y.XmlElement("blockGroup");
  group.insert(0, blocks.map(containerOf));
  return group;
}

/** Writes blocks into an empty BlockNote fragment without an editor, in the shape the editors and `fragmentToBlocks` read. */
export function writeBlocks(fragment: Y.XmlFragment, blocks: ImportBlock[]): void {
  if (blocks.length === 0) return;
  fragment.insert(0, [groupOf(blocks)]);
}

export function paragraphsOf(text: string): ImportBlock[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text: line, styles: {} }], children: [] }));
}
