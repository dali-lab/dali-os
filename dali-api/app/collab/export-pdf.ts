import PDFDocument from "pdfkit";
import type { PMNode } from "./export";

// Render ProseMirror JSON to a PDF buffer with pdfkit — pure JS, no headless
// browser, so it runs under `npm ci --omit=dev` on the Alpine runtime. Walks
// the same node tree as the HTML renderer in export.ts so the two formats stay
// consistent. Covers the StarterKit node/mark set; unknown nodes recurse into
// their children so content is never dropped.

type Run = { text: string; bold?: boolean; italic?: boolean; link?: string };

function collectRuns(node: PMNode, inherited: Partial<Run> = {}): Run[] {
  if (node.type === "text") {
    const marks = node.marks ?? [];
    return [
      {
        text: node.text ?? "",
        bold: inherited.bold || marks.some((m) => m.type === "bold"),
        italic: inherited.italic || marks.some((m) => m.type === "italic"),
        link:
          (marks.find((m) => m.type === "link")?.attrs?.href as string | undefined) ??
          inherited.link,
      },
    ];
  }
  if (node.type === "hardBreak") return [{ text: "\n" }];
  return (node.content ?? []).flatMap((c) => collectRuns(c, inherited));
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
      underline: !!run.link,
    });
  });
  doc.fillColor("#1a1a1a");
}

function renderBlock(doc: PDFKit.PDFDocument, node: PMNode, listPrefix?: string) {
  switch (node.type) {
    case "paragraph": {
      if (listPrefix) {
        doc.font("Times-Roman").fontSize(12).text(listPrefix, { continued: true });
      }
      writeInline(doc, collectRuns(node), 12);
      doc.moveDown(0.5);
      break;
    }
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      const size = level === 1 ? 22 : level === 2 ? 18 : 15;
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").fontSize(size);
      doc.fillColor("#1a1a1a").text(collectRuns(node).map((r) => r.text).join(""));
      doc.moveDown(0.4);
      break;
    }
    case "bulletList":
      (node.content ?? []).forEach((li) =>
        (li.content ?? []).forEach((child) => renderBlock(doc, child, "•  ")),
      );
      doc.moveDown(0.3);
      break;
    case "orderedList":
      (node.content ?? []).forEach((li, idx) =>
        (li.content ?? []).forEach((child) => renderBlock(doc, child, `${idx + 1}.  `)),
      );
      doc.moveDown(0.3);
      break;
    case "blockquote":
      doc.font("Times-Italic").fillColor("#555");
      (node.content ?? []).forEach((child) => renderBlock(doc, child));
      doc.fillColor("#1a1a1a");
      break;
    case "codeBlock":
      doc.font("Courier").fontSize(10).fillColor("#333");
      doc.text((node.content ?? []).map((c) => c.text ?? "").join(""));
      doc.fillColor("#1a1a1a");
      doc.moveDown(0.5);
      break;
    case "horizontalRule":
      doc.moveDown(0.3);
      doc
        .strokeColor("#ddd")
        .moveTo(doc.x, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(0.5);
      break;
    default:
      (node.content ?? []).forEach((child) => renderBlock(doc, child, listPrefix));
  }
}

export function renderProseMirrorToPdf(title: string, json: PMNode): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(28).fillColor("#1a1a1a").text(title);
    doc.moveDown(0.8);

    const blocks = json.content ?? [];
    if (blocks.length === 0) {
      doc.font("Times-Italic").fontSize(12).fillColor("#777").text("This document is empty.");
    } else {
      blocks.forEach((node) => renderBlock(doc, node));
    }

    doc.end();
  });
}
