// Pure ProseMirror-JSON → Markdown rendering. Sibling to export-html.ts;
// no DB import so it's unit-testable. Used by MCP `read_page` to deliver
// collab doc bodies as LLM-friendly markdown. Lossy for blocks outside the
// StarterKit set (tables, embeds, mentions render as plain text fallback).

import type { PMNode } from "./export-html";

function escape(text: string): string {
  // Backslash-escape markdown's structural characters in inline text so that
  // accidental sequences (e.g. "1)" at the start of a line) don't reflow.
  return text.replace(/([\\`*_{}\[\]()#+\-!.>])/g, "\\$1");
}

function applyMarks(text: string, marks: PMNode["marks"]): string {
  let out = escape(text);
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
        out = `**${out}**`;
        break;
      case "italic":
        out = `*${out}*`;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
      case "code":
        // Inline code: don't double-escape — backticks need to be the raw text.
        out = `\`${text}\``;
        break;
      case "link": {
        const href =
          typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
        out = `[${out}](${href})`;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function renderInline(nodes: PMNode[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((n) => {
      if (n.type === "text") return applyMarks(n.text ?? "", n.marks);
      if (n.type === "hardBreak") return "  \n";
      // Unknown inline → fall through to its text/content.
      return renderInline(n.content);
    })
    .join("");
}

function renderBlocks(nodes: PMNode[] | undefined, depth = 0): string {
  if (!nodes) return "";
  return nodes.map((n) => renderBlock(n, depth)).join("");
}

function renderBlock(node: PMNode, depth: number): string {
  switch (node.type) {
    case "paragraph":
      return `${renderInline(node.content)}\n\n`;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `${"#".repeat(level)} ${renderInline(node.content)}\n\n`;
    }
    case "bulletList":
      return renderList(node.content, depth, false);
    case "orderedList":
      return renderList(node.content, depth, true);
    case "listItem": {
      // Top-level case handled by renderList; this is only reached when a
      // listItem appears outside a list (defensive).
      return renderInline(node.content) + "\n";
    }
    case "blockquote": {
      const inner = renderBlocks(node.content, depth).trimEnd();
      return inner
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n") + "\n\n";
    }
    case "codeBlock": {
      const lang = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const text = (node.content ?? []).map((c) => c.text ?? "").join("");
      return `\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    }
    case "horizontalRule":
      return `---\n\n`;
    case "hardBreak":
      return "  \n";
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return `![${alt}](${src})\n\n`;
    }
    case "text":
      return applyMarks(node.text ?? "", node.marks);
    default:
      // Unknown block → flatten children to avoid dropping content silently.
      return renderBlocks(node.content, depth);
  }
}

function renderList(items: PMNode[] | undefined, depth: number, ordered: boolean): string {
  if (!items) return "";
  const indent = "  ".repeat(depth);
  let out = "";
  items.forEach((item, i) => {
    if (item.type !== "listItem") return;
    const marker = ordered ? `${i + 1}.` : "-";
    // Tiptap listItem wraps content in paragraph(s). Render the first block
    // inline-flush against the marker; subsequent blocks indent under.
    const children = item.content ?? [];
    if (children.length === 0) {
      out += `${indent}${marker} \n`;
      return;
    }
    const blocks: string[] = [];
    for (const child of children) {
      if (child.type === "paragraph") {
        blocks.push(renderInline(child.content));
      } else if (child.type === "bulletList") {
        blocks.push(renderList(child.content, depth + 1, false).trimEnd());
      } else if (child.type === "orderedList") {
        blocks.push(renderList(child.content, depth + 1, true).trimEnd());
      } else {
        blocks.push(renderBlock(child, depth + 1).trimEnd());
      }
    }
    const [first, ...rest] = blocks;
    out += `${indent}${marker} ${first}\n`;
    for (const block of rest) {
      const sub = block.split("\n").map((l) => `${indent}  ${l}`).join("\n");
      out += `${sub}\n`;
    }
  });
  return out + "\n";
}

export function renderMarkdown(doc: PMNode): string {
  return renderBlocks(doc.content).trimEnd() + "\n";
}
