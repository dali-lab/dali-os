import PDFDocument from "pdfkit";
import { formatDateShort } from "~/lib/display";
import { certificateFieldValue, type PlacedField } from "./certificate-fields";
import type { OfferingType } from "~/education/lib/offering-type";

// A one-page certificate. Two render paths: the built-in DALI design (fixed
// pdfkit layout — a designed artifact, not a document render), and a
// template-backed design (an operator-uploaded background image with dynamic
// fields placed on top). Which one is used is decided by the certificate's
// resolved templateId; see certificate-templates.server.ts.

export type CertificateData = {
  studentName: string;
  offeringTitle: string;
  offeringType: OfferingType;
  startsAt: Date | null;
  endsAt: Date | null;
  instructorNames: string[];
  issuedAt: Date;
};

export type CertificateTemplateRender = {
  bgWidth: number;
  bgHeight: number;
  fields: PlacedField[];
  background: Buffer;
};

export function renderCertificatePdf(
  cert: CertificateData,
  template?: CertificateTemplateRender | null,
): Promise<Buffer> {
  return template ? renderTemplatePdf(cert, template) : renderBuiltinPdf(cert);
}

/** Resolved string for each placeable field key. */
function fieldValues(cert: CertificateData): Parameters<typeof certificateFieldValue>[1] {
  return {
    studentName: cert.studentName,
    offeringTitle: cert.offeringTitle,
    dateRange:
      cert.startsAt && cert.endsAt
        ? `${formatDateShort(cert.startsAt)} – ${formatDateShort(cert.endsAt)}`
        : "",
    instructors: cert.instructorNames.join(", "),
    issuedDate: formatDateShort(cert.issuedAt),
  };
}

// The page is sized to the background's pixel dimensions (1px = 1pt), so a
// field's fractional (x, y) maps to the same spot here as in the editor
// preview. `align` treats (x, y) as the text's left edge / centre / right edge.
function renderTemplatePdf(
  cert: CertificateData,
  t: CertificateTemplateRender,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [t.bgWidth, t.bgHeight], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.image(t.background, 0, 0, { width: t.bgWidth, height: t.bgHeight });

    const values = fieldValues(cert);
    for (const f of t.fields) {
      const text = certificateFieldValue(f.key, values);
      if (!text) continue;
      doc
        .font(f.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(f.fontSize)
        .fillColor(f.color);
      const w = doc.widthOfString(text);
      const px = f.x * t.bgWidth;
      const py = f.y * t.bgHeight;
      const x = f.align === "center" ? px - w / 2 : f.align === "right" ? px - w : px;
      doc.text(text, x, py, { lineBreak: false });
    }
    doc.end();
  });
}

function renderBuiltinPdf(cert: CertificateData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width;
    const height = doc.page.height;

    // Border — DALI coral outer frame with a navy inner rule.
    doc.rect(24, 24, width - 48, height - 48).lineWidth(3).stroke("#ff6b5d");
    doc.rect(36, 36, width - 72, height - 72).lineWidth(1).stroke("#1c2b4a");

    doc.fillColor("#1c2b4a");
    doc.font("Times-Bold").fontSize(14).text("DALI LAB", 0, 84, {
      align: "center",
      characterSpacing: 4,
    });
    doc.font("Times-Roman").fontSize(20).text("Certificate of Completion", 0, 120, {
      align: "center",
    });

    doc.font("Times-Italic").fontSize(12).fillColor("#555555");
    doc.text("This certifies that", 0, 180, { align: "center" });

    doc.font("Times-Bold").fontSize(34).fillColor("#1c2b4a");
    doc.text(cert.studentName, 0, 205, { align: "center" });

    doc.font("Times-Italic").fontSize(12).fillColor("#555555");
    doc.text(
      `completed the ${cert.offeringType.toLowerCase()}`,
      0,
      255,
      { align: "center" },
    );

    doc.font("Times-Bold").fontSize(22).fillColor("#ff6b5d");
    doc.text(cert.offeringTitle, 60, 280, {
      align: "center",
      width: width - 120,
    });

    doc.font("Times-Roman").fontSize(12).fillColor("#1c2b4a");
    doc.text(
      cert.startsAt && cert.endsAt
        ? `${formatDateShort(cert.startsAt)} – ${formatDateShort(cert.endsAt)}`
        : "Date TBD",
      0,
      330,
      { align: "center" },
    );

    if (cert.instructorNames.length > 0) {
      doc.font("Times-Roman").fontSize(11).fillColor("#555555");
      doc.text(`Taught by ${cert.instructorNames.join(", ")}`, 0, 370, {
        align: "center",
      });
    }

    doc.font("Times-Roman").fontSize(10).fillColor("#888888");
    doc.text(`Issued ${formatDateShort(cert.issuedAt)}`, 0, height - 100, {
      align: "center",
    });

    doc.end();
  });
}
