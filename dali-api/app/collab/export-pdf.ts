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
//
// Styling follows the DALI brand: a sans body (Helvetica, standing in for the
// brand's Open Sans), headings + links in DALI blue, a coral title accent, and
// drawn check boxes. It re-lays-out the content — it is NOT a pixel copy of the
// web CSS (that would need a headless browser we deliberately don't run here).

// DALI palette (see the lab style guide): DALI blue for headings/links, the
// neutral dark for body text, coral as the accent, a light neutral for rules.
const BRAND = {
  heading: "#1E5779",
  body: "#404040",
  muted: "#6B7280",
  link: "#1E5779",
  accent: "#FF8B81",
  rule: "#C6CACC",
} as const;

const BODY_SIZE = 11.5;

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
          // pdfkit core fonts lack a ballot-box glyph, so an inline checkbox
          // field renders as [x]/[ ] followed by its label. (Check-LIST items,
          // which are their own blocks, get a drawn box — see renderBlock.)
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
  if (run.bold && run.italic) return "Helvetica-BoldOblique";
  if (run.bold) return "Helvetica-Bold";
  if (run.italic) return "Helvetica-Oblique";
  return "Helvetica";
}

function writeInline(doc: PDFKit.PDFDocument, runs: Run[], fontSize: number) {
  if (runs.length === 0) {
    doc.text(" ");
    return;
  }
  runs.forEach((run, i) => {
    const isLast = i === runs.length - 1;
    doc.font(fontFor(run)).fontSize(fontSize);
    doc.fillColor(run.link ? BRAND.link : BRAND.body);
    doc.text(run.text, {
      continued: !isLast,
      link: run.link ?? undefined,
      underline: run.underline || !!run.link,
    });
  });
  doc.fillColor(BRAND.body);
}

// Render a sequence of sibling blocks. Numbering for consecutive
// numberedListItem blocks is computed here (BlockNote items are free-standing
// siblings, not children of a list container).
function renderBlockList(doc: PDFKit.PDFDocument, blocks: DocBlock[]) {
  let number = 0;
  for (const block of blocks) {
    // Frozen signing bodies are stored block JSON and passed through
    // ensureBlocks un-normalized, so a malformed/partial block can slip in —
    // skip anything that isn't a real block rather than crash the whole render.
    if (!block || typeof block !== "object") continue;
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
  // `children` is absent on un-normalized passthrough blocks (see ensureBlocks);
  // treat missing as no children instead of throwing on `.length`.
  const children = block.children ?? [];
  if (children.length === 0) return;
  // Indent nested content under its parent.
  const prev = doc.x;
  doc.x = prev + 18;
  renderBlockList(doc, children);
  doc.x = prev;
}

// Draw a small check box at the current line start and advance the cursor past
// it, so the label can follow as continued text. Returns nothing; leaves doc.x
// just to the right of the box.
function drawCheckBox(doc: PDFKit.PDFDocument, checked: boolean) {
  const size = 9.5;
  const x = doc.x;
  const y = doc.y + 1.5; // nudge down to sit on the text baseline
  doc.save();
  doc
    .lineWidth(1)
    .strokeColor(checked ? BRAND.accent : BRAND.rule)
    .roundedRect(x, y, size, size, 2)
    .stroke();
  if (checked) {
    doc
      .strokeColor(BRAND.accent)
      .lineWidth(1.4)
      .moveTo(x + 2, y + size * 0.55)
      .lineTo(x + size * 0.42, y + size - 2)
      .lineTo(x + size - 1.5, y + 1.8)
      .stroke();
  }
  doc.restore();
  doc.x = x + size + 6;
}

function renderBlock(doc: PDFKit.PDFDocument, block: DocBlock, listPrefix?: string) {
  switch (block.type) {
    case "paragraph": {
      if (listPrefix) {
        doc.font("Helvetica").fontSize(BODY_SIZE).fillColor(BRAND.body).text(listPrefix, { continued: true });
      }
      writeInline(doc, blockRuns(block), BODY_SIZE);
      doc.moveDown(0.5);
      renderChildren(doc, block);
      break;
    }
    case "heading": {
      const level = Math.min(Math.max(Number(block.props?.level ?? 1), 1), 6);
      const size = level === 1 ? 19 : level === 2 ? 16 : 14;
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(size).fillColor(BRAND.heading).text(blockText(block));
      doc.moveDown(0.35);
      renderChildren(doc, block);
      break;
    }
    case "bulletListItem": {
      doc.font("Helvetica").fontSize(BODY_SIZE).fillColor(BRAND.body).text(listPrefix ?? "•  ", { continued: true });
      writeInline(doc, blockRuns(block), BODY_SIZE);
      doc.moveDown(0.3);
      renderChildren(doc, block);
      break;
    }
    case "numberedListItem": {
      doc.font("Helvetica").fontSize(BODY_SIZE).fillColor(BRAND.body).text(listPrefix ?? "1.  ", { continued: true });
      writeInline(doc, blockRuns(block), BODY_SIZE);
      doc.moveDown(0.3);
      renderChildren(doc, block);
      break;
    }
    case "checkListItem": {
      drawCheckBox(doc, block.props?.checked === true);
      writeInline(doc, blockRuns(block), BODY_SIZE);
      doc.moveDown(0.3);
      renderChildren(doc, block);
      break;
    }
    case "quote":
      doc.font("Helvetica-Oblique").fontSize(BODY_SIZE).fillColor(BRAND.muted);
      doc.text(blockText(block) || " ");
      doc.fillColor(BRAND.body);
      doc.moveDown(0.5);
      renderChildren(doc, block);
      break;
    case "codeBlock": {
      doc.font("Courier").fontSize(10).fillColor(BRAND.body);
      doc.text(blockText(block) || " ");
      doc.fillColor(BRAND.body);
      doc.moveDown(0.5);
      break;
    }
    case "divider":
      doc.moveDown(0.3);
      doc
        .strokeColor(BRAND.rule)
        .lineWidth(1)
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
      doc.font("Helvetica-Oblique").fontSize(10.5).fillColor(BRAND.muted);
      doc.text(caption ? `[Image: ${caption}]` : "[Image]");
      doc.fillColor(BRAND.body);
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
        doc.font("Helvetica").fontSize(BODY_SIZE).fillColor(BRAND.link);
        doc.text(label, { link: url, underline: true });
        doc.fillColor(BRAND.body);
      } else {
        doc.font("Helvetica-Oblique").fontSize(10.5).fillColor(BRAND.muted);
        doc.text(`[File: ${label || "attachment"}]`);
        doc.fillColor(BRAND.body);
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
      if (url) {
        doc.font("Helvetica").fontSize(BODY_SIZE).fillColor(BRAND.link);
        doc.text(caption ? `[Video: ${caption}]` : "[Video]", { link: url, underline: true });
      } else {
        doc.font("Helvetica-Oblique").fontSize(10.5).fillColor(BRAND.muted);
        doc.text(caption ? `[Video: ${caption}]` : "[Video]");
      }
      doc.fillColor(BRAND.body);
      doc.moveDown(0.5);
      break;
    }
    case "toggleListItem": {
      // Print the summary as a bold line, then the (always-expanded) body.
      doc.font("Helvetica-Bold").fontSize(BODY_SIZE).fillColor(BRAND.heading);
      doc.text(blockText(block) || "Toggle");
      doc.fillColor(BRAND.body);
      doc.moveDown(0.2);
      renderChildren(doc, block);
      doc.moveDown(0.3);
      break;
    }
    case "callout": {
      // Render like a blockquote (italic, muted) — pdfkit's core fonts have no
      // emoji glyph, so the marker is dropped rather than rendered as tofu.
      doc.font("Helvetica-Oblique").fontSize(BODY_SIZE).fillColor(BRAND.muted);
      doc.text(blockText(block) || " ");
      renderChildren(doc, block);
      doc.fillColor(BRAND.body);
      doc.moveDown(0.3);
      break;
    }
    case "table": {
      const content = block.content as
        | { rows?: { cells?: (DocTableCell | DocInline[])[] }[] }
        | undefined;
      doc.font("Helvetica").fontSize(10.5).fillColor(BRAND.body);
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
        writeInline(doc, blockRuns(block), BODY_SIZE);
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

    // Title, in DALI blue, underlined with a short coral accent rule.
    doc.font("Helvetica-Bold").fontSize(24).fillColor(BRAND.heading).text(title);
    doc.moveDown(0.35);
    const ruleY = doc.y;
    doc
      .save()
      .strokeColor(BRAND.accent)
      .lineWidth(2.5)
      .moveTo(doc.page.margins.left, ruleY)
      .lineTo(doc.page.margins.left + 64, ruleY)
      .stroke()
      .restore();
    doc.moveDown(0.9);
    doc.fillColor(BRAND.body);

    if (blocks.length === 0) {
      doc.font("Helvetica-Oblique").fontSize(BODY_SIZE).fillColor(BRAND.muted).text("This document is empty.");
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
