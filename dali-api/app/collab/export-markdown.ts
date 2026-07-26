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
      case "underline":
        // Markdown has no underline — pass through as HTML (renders in GitHub
        // and most markdown viewers).
        out = `<u>${out}</u>`;
        break;
      case "highlight":
        // Markdown has no highlight — pass through as HTML <mark>.
        out = `<mark>${out}</mark>`;
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
    case "toggleBlock": {
      // First child may be a toggleSummary; the rest is the collapsible body.
      // Emit as <details> HTML so it renders (collapsibly) on GitHub and keeps
      // the summary + body readable in plain markdown.
      const children = node.content ?? [];
      const hasSummary = children[0]?.type === "toggleSummary";
      const summary = hasSummary ? renderInline(children[0]!.content) : "Toggle";
      const body = renderBlocks(hasSummary ? children.slice(1) : children, depth).trimEnd();
      return `<details><summary>${summary || "Toggle"}</summary>\n\n${body}\n\n</details>\n\n`;
    }
    case "toggleSummary":
      return renderInline(node.content);
    case "callout": {
      const emoji = typeof node.attrs?.emoji === "string" ? node.attrs.emoji : "💡";
      const inner = renderBlocks(node.content, depth).trimEnd();
      return (
        inner
          .split("\n")
          .map((line, i) => (i === 0 ? `> ${emoji} ${line}` : `> ${line}`))
          .join("\n") + "\n\n"
      );
    }
    case "taskList":
      return renderTaskList(node.content, depth);
    case "taskItem":
      // Reached only outside a taskList (defensive) — render its text.
      return renderInline((node.content?.[0]?.content) ?? node.content);
    case "table":
      return renderTable(node.content);
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

function renderTaskList(items: PMNode[] | undefined, depth: number): string {
  if (!items) return "";
  const indent = "  ".repeat(depth);
  let out = "";
  for (const item of items) {
    if (item.type !== "taskItem") continue;
    const box = item.attrs?.checked === true ? "[x]" : "[ ]";
    const children = item.content ?? [];
    const first =
      children[0]?.type === "paragraph" ? renderInline(children[0].content) : "";
    out += `${indent}- ${box} ${first}\n`;
    // Nested task lists (TaskItem nested: true) indent under the parent.
    for (const child of children.slice(1)) {
      if (child.type === "taskList") out += renderTaskList(child.content, depth + 1);
    }
  }
  return out + "\n";
}

// Flatten a table cell to a single line of inline text (GFM cells can't hold
// block structure). Pipes and newlines are escaped/collapsed so they don't
// break the table.
function cellText(cell: PMNode): string {
  const paras = (cell.content ?? []).map((b) =>
    b.type === "paragraph" ? renderInline(b.content) : renderInline(b.content),
  );
  return paras.join(" ").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function renderTable(rows: PMNode[] | undefined): string {
  const grid = (rows ?? [])
    .filter((r) => r.type === "tableRow")
    .map((r) => (r.content ?? []).map(cellText));
  if (grid.length === 0) return "";
  const cols = Math.max(...grid.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(cols - r.length).fill("")];
  const header = pad(grid[0]!);
  let out = `| ${header.join(" | ")} |\n`;
  out += `| ${header.map(() => "---").join(" | ")} |\n`;
  for (const row of grid.slice(1)) out += `| ${pad(row).join(" | ")} |\n`;
  return out + "\n";
}

export function renderMarkdown(doc: PMNode): string {
  return renderBlocks(doc.content).trimEnd() + "\n";
}
