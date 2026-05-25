// Pure ProseMirror-JSON → HTML rendering for the document export pipeline.
// Deliberately free of any DB / Prisma import so it can be unit-tested and
// reused without loading the database client. The DB-coupled decode functions
// live in export.ts (which re-exports these); the PDF renderer in export-pdf.ts
// walks the same node/mark set so the two formats stay visually consistent.

export type PMNode = {
  type: string;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Wrap text in its mark elements (bold/italic/etc.). StarterKit's default mark
// set; unknown marks pass through unwrapped.
function applyMarks(text: string, marks: PMNode["marks"]): string {
  let html = escapeHtml(text);
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
        html = `<strong>${html}</strong>`;
        break;
      case "italic":
        html = `<em>${html}</em>`;
        break;
      case "strike":
        html = `<s>${html}</s>`;
        break;
      case "code":
        html = `<code>${html}</code>`;
        break;
      case "underline":
        html = `<u>${html}</u>`;
        break;
      case "link": {
        const href = typeof mark.attrs?.href === "string" ? escapeHtml(mark.attrs.href) : "#";
        html = `<a href="${href}">${html}</a>`;
        break;
      }
      default:
        break;
    }
  }
  return html;
}

export function renderNodes(nodes: PMNode[] | undefined): string {
  if (!nodes) return "";
  return nodes.map(renderNode).join("");
}

function renderNode(node: PMNode): string {
  switch (node.type) {
    case "text":
      return applyMarks(node.text ?? "", node.marks);
    case "paragraph":
      return `<p>${renderNodes(node.content)}</p>`;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `<h${level}>${renderNodes(node.content)}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${renderNodes(node.content)}</ul>`;
    case "orderedList":
      return `<ol>${renderNodes(node.content)}</ol>`;
    case "listItem":
      return `<li>${renderNodes(node.content)}</li>`;
    case "blockquote":
      return `<blockquote>${renderNodes(node.content)}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${escapeHtml(
        (node.content ?? []).map((c) => c.text ?? "").join(""),
      )}</code></pre>`;
    case "horizontalRule":
      return "<hr />";
    case "hardBreak":
      return "<br />";
    default:
      // Unknown block: render its children so content is never dropped.
      return renderNodes(node.content);
  }
}

// Full standalone HTML document with print-friendly styling, used by both
// renderers. `title` becomes the H1 (Notion-style — the page title is the doc
// title).
export function buildExportHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; line-height: 1.6; max-width: 720px; margin: 0 auto; padding: 48px 32px; }
  h1 { font-family: Helvetica, Arial, sans-serif; font-size: 28px; font-weight: 700; margin: 0 0 24px; }
  h2 { font-family: Helvetica, Arial, sans-serif; font-size: 22px; font-weight: 700; margin: 28px 0 12px; }
  h3 { font-family: Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 700; margin: 24px 0 10px; }
  p { margin: 0 0 12px; }
  ul, ol { margin: 0 0 12px 24px; }
  blockquote { border-left: 3px solid #ddd; margin: 0 0 12px; padding-left: 16px; color: #555; }
  pre { background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; font-family: "SF Mono", Menlo, monospace; font-size: 13px; }
  code { font-family: "SF Mono", Menlo, monospace; font-size: 0.9em; }
  hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
  a { color: #1155cc; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${bodyHtml || "<p><em>This document is empty.</em></p>"}
</body>
</html>`;
}
