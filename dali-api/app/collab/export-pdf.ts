import PDFDocument from "pdfkit";
import type { DocBlock, DocInline, DocTableCell } from "./blocknote-server";
import { ensureBlocks } from "./legacy/pm-to-blocknote";
import type { PMNode } from "./export-html";
import {
  isSigningFieldType,
  isCheckboxChecked,
  fieldCaption,
  fieldDisplayText,
  variableDisplayText,
  type SigningFieldType,
} from "~/lib/signing-fields";

// Render BlockNote block JSON to a PDF buffer with pdfkit — pure JS, no
// headless browser, so it runs under `npm ci --omit=dev` on the Alpine
// runtime. Covers the full document schema (headings, lists, check lists,
// quote, code, divider, images-as-placeholders, toggles, callouts, tables,
// marks, links, mentions, signing fields, variables); unknown blocks degrade
// to their text so content is never dropped.

type Run = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; link?: string };

function inlineRuns(content: DocInline[] | undefined, inherited: Partial<Run> = {}): Run[] {
  const out: Run[] = [];
  for (const inline of content ?? []) {
    switch (inline.type) {
      case "text": {
        const styles = inline.styles ?? {};
        out.push({
          text: inline.text ?? "",
          bold: inherited.bold || styles.bold === true,
          italic: inherited.italic || styles.italic === true,
          underline: inherited.underline || styles.underline === true,
          link: inherited.link,
        });
        break;
      }
      case "link":
        out.push(...inlineRuns(inline.content, { ...inherited, link: inline.href ?? "" }));
        break;
      case "mention":
        out.push({ ...inherited, text: `@${String(inline.props?.label ?? "")}` } as Run);
        break;
      case "variable": {
        const name = typeof inline.props?.name === "string" ? inline.props.name : "";
        out.push({ ...inherited, text: variableDisplayText(name, inline.props?.value) } as Run);
        break;
      }
      default: {
        if (isSigningFieldType(inline.type)) {
          const type = inline.type as SigningFieldType;
          const label = typeof inline.props?.label === "string" ? inline.props.label : "";
          // pdfkit core fonts lack ballot-box glyphs, so checkboxes render as
          // [x]/[ ] like check lists do — followed by their label.
          if (type === "checkboxField") {
            const box = isCheckboxChecked(inline.props?.value) ? "[x]" : "[ ]";
            out.push({ text: label.trim() ? `${box} ${label.trim()}` : box });
          } else {
            const text = fieldDisplayText(type, inline.props?.value);
            if (text) {
              out.push({ text, underline: true });
            } else {
              // Unfilled field: a blank line + a caption naming its kind.
              out.push({ text: "__________", underline: true });
              out.push({ ...inherited, text: ` (${fieldCaption(type, label)})` } as Run);
            }
          }
        } else if (typeof inline.text === "string") {
          out.push({ ...inherited, text: inline.text } as Run);
        }
        break;
      }
    }
  }
  return out;
}

function blockRuns(block: DocBlock): Run[] {
  return Array.isArray(block.content) ? inlineRuns(block.content as DocInline[]) : [];
}

function blockText(block: DocBlock): string {
  return blockRuns(block).map((r) => r.text).join("");
}

function cellRuns(cell: DocTableCell | DocInline[]): Run[] {
  return inlineRuns(Array.isArray(cell) ? cell : cell.content);
}

function fontFor(run: Run): string {
  if (run.bold && run.italic) return "Times-BoldItalic";
  if (run.bold) return "Times-Bold";
  if (run.italic) return "Times-Italic";
  return "Times-Roman";
}

function writeInline(doc: PDFKit.PDFDocument, runs: Run[], fontSize: number) {
  if (runs.length === 0) {
    doc.text(" ");
    return;
  }
  runs.forEach((run, i) => {
    const isLast = i === runs.length - 1;
    doc.font(fontFor(run)).fontSize(fontSize);
    if (run.link) doc.fillColor("#1155cc");
    else doc.fillColor("#1a1a1a");
    doc.text(run.text, {
      continued: !isLast,
      link: run.link ?? undefined,
      underline: run.underline || !!run.link,
    });
  });
  doc.fillColor("#1a1a1a");
}

// Render a sequence of sibling blocks. Numbering for consecutive
// numberedListItem blocks is computed here (BlockNote items are free-standing
// siblings, not children of a list container).
function renderBlockList(doc: PDFKit.PDFDocument, blocks: DocBlock[]) {
  let number = 0;
  for (const block of blocks) {
    if (block.type === "numberedListItem") {
      const start = Number(block.props?.start);
      number = number === 0 ? (Number.isFinite(start) && start > 0 ? start : 1) : number + 1;
      renderBlock(doc, block, `${number}.  `);
    } else {
      number = 0;
      renderBlock(doc, block);
    }
  }
}

function renderChildren(doc: PDFKit.PDFDocument, block: DocBlock) {
  if (block.children.length === 0) return;
  // Indent nested content under its parent.
  const prev = doc.x;
  doc.x = prev + 18;
  renderBlockList(doc, block.children);
  doc.x = prev;
}

function renderBlock(doc: PDFKit.PDFDocument, block: DocBlock, listPrefix?: string) {
  switch (block.type) {
    case "paragraph": {
      if (listPrefix) {
        doc.font("Times-Roman").fontSize(12).text(listPrefix, { continued: true });
      }
      writeInline(doc, blockRuns(block), 12);
      doc.moveDown(0.5);
      renderChildren(doc, block);
      break;
    }
    case "heading": {
      const level = Math.min(Math.max(Number(block.props?.level ?? 1), 1), 6);
      const size = level === 1 ? 22 : level === 2 ? 18 : 15;
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").fontSize(size);
      doc.fillColor("#1a1a1a").text(blockText(block));
      doc.moveDown(0.4);
      renderChildren(doc, block);
      break;
    }
    case "bulletListItem": {
      doc.font("Times-Roman").fontSize(12).text(listPrefix ?? "•  ", { continued: true });
      writeInline(doc, blockRuns(block), 12);
      doc.moveDown(0.3);
      renderChildren(doc, block);
      break;
    }
    case "numberedListItem": {
      doc.font("Times-Roman").fontSize(12).text(listPrefix ?? "1.  ", { continued: true });
      writeInline(doc, blockRuns(block), 12);
      doc.moveDown(0.3);
      renderChildren(doc, block);
      break;
    }
    case "checkListItem": {
      const box = block.props?.checked === true ? "[x]  " : "[ ]  ";
      doc.font("Times-Roman").fontSize(12).text(box, { continued: true });
      writeInline(doc, blockRuns(block), 12);
      doc.moveDown(0.3);
      renderChildren(doc, block);
      break;
    }
    case "quote":
      doc.font("Times-Italic").fontSize(12).fillColor("#555");
      doc.text(blockText(block) || " ");
      doc.fillColor("#1a1a1a");
      doc.moveDown(0.5);
      renderChildren(doc, block);
      break;
    case "codeBlock": {
      doc.font("Courier").fontSize(10).fillColor("#333");
      doc.text(blockText(block) || " ");
      doc.fillColor("#1a1a1a");
      doc.moveDown(0.5);
      break;
    }
    case "divider":
      doc.moveDown(0.3);
      doc
        .strokeColor("#ddd")
        .moveTo(doc.x, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(0.5);
      break;
    case "pageBreak":
      doc.addPage();
      break;
    case "image": {
      // Fetching + embedding the binary is out of scope for the PDF pipeline;
      // degrade to a labelled placeholder so the reader knows content exists.
      const caption =
        typeof block.props?.caption === "string" && block.props.caption
          ? block.props.caption
          : "";
      doc.font("Times-Italic").fontSize(11).fillColor("#555");
      doc.text(caption ? `[Image: ${caption}]` : "[Image]");
      doc.fillColor("#1a1a1a");
      doc.moveDown(0.5);
      break;
    }
    case "file": {
      // Render as a link line — pdfkit supports `link` option on text().
      const url = typeof block.props?.url === "string" ? block.props.url : "";
      const name =
        typeof block.props?.name === "string" && block.props.name
          ? block.props.name
          : url.split("/").pop() ?? "File";
      const caption =
        typeof block.props?.caption === "string" && block.props.caption
          ? block.props.caption
          : "";
      const label = caption || name;
      if (url) {
        doc.font("Times-Roman").fontSize(12).fillColor("#1155cc");
        doc.text(label, { link: url, underline: true });
        doc.fillColor("#1a1a1a");
      } else {
        doc.font("Times-Italic").fontSize(11).fillColor("#555");
        doc.text(`[File: ${label || "attachment"}]`);
        doc.fillColor("#1a1a1a");
      }
      doc.moveDown(0.5);
      break;
    }
    case "video": {
      // PDFs cannot embed video; degrade to a link the same way image degrades
      // to a placeholder.
      const url = typeof block.props?.url === "string" ? block.props.url : "";
      const caption =
        typeof block.props?.caption === "string" && block.props.caption
          ? block.props.caption
          : "";
      doc.font("Times-Italic").fontSize(11).fillColor("#555");
      if (url) {
        const label = caption ? `[Video: ${caption}]` : "[Video]";
        doc.text(label, { link: url, underline: true });
      } else {
        doc.text(caption ? `[Video: ${caption}]` : "[Video]");
      }
      doc.fillColor("#1a1a1a");
      doc.moveDown(0.5);
      break;
    }
    case "toggleListItem": {
      // Print the summary as a bold line, then the (always-expanded) body.
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#1a1a1a");
      doc.text(blockText(block) || "Toggle");
      doc.moveDown(0.2);
      renderChildren(doc, block);
      doc.moveDown(0.3);
      break;
    }
    case "callout": {
      // Render like a blockquote (italic, gray) — pdfkit's core fonts have no
      // emoji glyph, so the marker is dropped rather than rendered as tofu.
      doc.font("Times-Italic").fontSize(12).fillColor("#555");
      doc.text(blockText(block) || " ");
      renderChildren(doc, block);
      doc.fillColor("#1a1a1a");
      doc.moveDown(0.3);
      break;
    }
    case "table": {
      const content = block.content as
        | { rows?: { cells?: (DocTableCell | DocInline[])[] }[] }
        | undefined;
      doc.font("Times-Roman").fontSize(11).fillColor("#1a1a1a");
      for (const row of content?.rows ?? []) {
        const cells = (row.cells ?? []).map((cell) =>
          cellRuns(cell)
            .map((r) => r.text)
            .join("")
            .replace(/\s+/g, " ")
            .trim(),
        );
        doc.text(cells.join("   |   "));
      }
      doc.moveDown(0.5);
      break;
    }
    default:
      // Unknown block: render its text + children so content is never dropped.
      if (Array.isArray(block.content)) {
        writeInline(doc, blockRuns(block), 12);
        doc.moveDown(0.5);
      }
      renderChildren(doc, block);
      break;
  }
}

export function renderBlocksToPdf(title: string, blocks: DocBlock[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(28).fillColor("#1a1a1a").text(title);
    doc.moveDown(0.8);

    if (blocks.length === 0) {
      doc.font("Times-Italic").fontSize(12).fillColor("#777").text("This document is empty.");
    } else {
      renderBlockList(doc, blocks);
    }

    doc.end();
  });
}

// Compatibility entry point: accepts either legacy ProseMirror JSON (signing
// frozen bodies stay PM forever — they are never transcoded) or block JSON,
// normalized through ensureBlocks.
export function renderProseMirrorToPdf(
  title: string,
  json: PMNode | DocBlock[],
): Promise<Buffer> {
  return renderBlocksToPdf(title, ensureBlocks(json));
}
