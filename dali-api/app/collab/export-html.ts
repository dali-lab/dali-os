// LEGACY pure ProseMirror-JSON → HTML rendering, plus the shared PMNode type
// and the buildExportHtml document shell (both still current). The live HTML
// export path is blocks-based (blocksToHtml in blocknote-server.ts);
// renderNodes remains for PM-JSON inputs that are never transcoded — signing
// frozen bodies — and as the reference renderer for legacy fixtures.
// Deliberately free of any DB / Prisma import so it can be unit-tested and
// reused without loading the database client.

import {
  isSigningFieldType,
  fieldCaption,
  fieldDisplayText,
  variableDisplayText,
  type SigningFieldType,
} from "~/lib/signing-fields";

export type PMNode = {
  type: string;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
};

// Signing field / variable atoms — inline leaf nodes. Values are baked into
// attrs.value by bakeSigningBody before export, so the renderer reads attrs
// only. An unfilled field renders as a blank signature line.
function renderSigningFieldHtml(node: PMNode): string {
  const type = node.type as SigningFieldType;
  const value = node.attrs?.value;
  const label = node.attrs?.label;
  if (type === "checkboxField") {
    const lbl = typeof label === "string" && label.trim() ? ` ${escapeHtml(label.trim())}` : "";
    return `<span>${fieldDisplayText(type, value)}${lbl}</span>`;
  }
  const text = fieldDisplayText(type, value);
  if (text) {
    return `<span style="border-bottom:1px solid #333;padding:0 4px;font-style:italic;">${escapeHtml(text)}</span>`;
  }
  // Unfilled field: a blank line + a small caption naming its kind, so an
  // exported blank agreement reads the same as the on-screen preview.
  const caption = escapeHtml(fieldCaption(type, label));
  return `<span style="display:inline-block;min-width:160px;border-bottom:1px solid #333;">&nbsp;</span><span style="font-size:0.75em;color:#666;"> (${caption})</span>`;
}

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
      case "highlight": {
        const color =
          typeof mark.attrs?.color === "string" ? escapeHtml(mark.attrs.color) : "";
        html = color
          ? `<mark style="background-color:${color}">${html}</mark>`
          : `<mark>${html}</mark>`;
        break;
      }
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
    case "pageBreak":
      return '<div class="page-break" style="break-after:page;page-break-after:always;border-top:1px dashed #bbb;margin:24px 0;" aria-hidden="true"></div>';
    case "hardBreak":
      return "<br />";
    case "image": {
      const src = typeof node.attrs?.src === "string" ? escapeHtml(node.attrs.src) : "";
      const alt = typeof node.attrs?.alt === "string" ? escapeHtml(node.attrs.alt) : "";
      if (!src) return "";
      const align = node.attrs?.align;
      const width = node.attrs?.width;
      const alignAttr = align === "left" || align === "right" ? ` data-align="${align}"` : "";
      const widthStyle = typeof width === "number" && width > 0 ? ` style="width:${width}px"` : "";
      return `<img src="${src}" alt="${alt}"${alignAttr}${widthStyle} />`;
    }
    case "file": {
      // Render as a download link; fall back gracefully when no URL is stored.
      const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      const name =
        typeof node.attrs?.name === "string" && node.attrs.name
          ? node.attrs.name
          : url.split("/").pop() ?? "File";
      const caption = typeof node.attrs?.caption === "string" ? node.attrs.caption : "";
      if (!url) return "";
      const label = escapeHtml(caption || name);
      return `<p><a href="${escapeHtml(url)}" download="${escapeHtml(name)}">${label}</a></p>`;
    }
    case "video": {
      // Render as a native <video> when a URL is present; degrade to a link
      // when it is missing.
      const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      const caption = typeof node.attrs?.caption === "string" ? node.attrs.caption : "";
      if (!url) return "";
      const captionHtml = caption
        ? `<figcaption>${escapeHtml(caption)}</figcaption>`
        : "";
      return `<figure><video src="${escapeHtml(url)}" controls style="max-width:100%;border-radius:6px;"></video>${captionHtml}</figure>`;
    }
    case "toggleBlock": {
      // First child may be a toggleSummary; the rest is the collapsible body.
      // Render as native <details> so it round-trips and stays interactive in
      // exported HTML / GitHub markdown previews.
      const children = node.content ?? [];
      const hasSummary = children[0]?.type === "toggleSummary";
      const summaryHtml = hasSummary ? renderNodes(children[0]!.content) : "Toggle";
      const bodyHtml = renderNodes(hasSummary ? children.slice(1) : children);
      const open = node.attrs?.open !== false ? " open" : "";
      return `<details${open}><summary>${summaryHtml || "Toggle"}</summary>${bodyHtml}</details>`;
    }
    case "toggleSummary":
      // Only reached if a summary appears outside a toggle (defensive).
      return renderNodes(node.content);
    case "callout": {
      const emoji = typeof node.attrs?.emoji === "string" ? node.attrs.emoji : "💡";
      // Inline styles (not a class) so the export survives html-to-docx too.
      return `<div style="display:flex;gap:8px;padding:8px 12px;margin:8px 0;border:1px solid #ddd;border-radius:6px;background:#f7f7f7;"><span>${escapeHtml(
        emoji,
      )}</span><div>${renderNodes(node.content)}</div></div>`;
    }
    case "taskList":
      return `<ul style="list-style:none;padding-left:0;">${renderNodes(node.content)}</ul>`;
    case "taskItem": {
      const checked = node.attrs?.checked === true;
      return `<li>${checked ? "☑" : "☐"} ${renderNodes(node.content)}</li>`;
    }
    case "table":
      return `<table>${renderNodes(node.content)}</table>`;
    case "tableRow":
      return `<tr>${renderNodes(node.content)}</tr>`;
    case "tableHeader":
      return `<th>${renderNodes(node.content)}</th>`;
    case "tableCell":
      return `<td>${renderNodes(node.content)}</td>`;
    case "variable": {
      const name = typeof node.attrs?.name === "string" ? node.attrs.name : "";
      return `<span>${escapeHtml(variableDisplayText(name, node.attrs?.value))}</span>`;
    }
    default:
      // Signing field atoms render their captured value / a signature line.
      if (isSigningFieldType(node.type)) return renderSigningFieldHtml(node);
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
  img { max-width: 100%; height: auto; border-radius: 6px; margin: 12px 0; }
  mark { padding: 0 2px; border-radius: 2px; }
  details { margin: 8px 0; }
  summary { font-weight: 600; cursor: pointer; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 600; }
  .page-break { break-after: page; page-break-after: always; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${bodyHtml || "<p><em>This document is empty.</em></p>"}
</body>
</html>`;
}
