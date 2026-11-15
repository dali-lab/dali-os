import PDFDocument from "pdfkit";
import { formatDateShort } from "~/lib/display";
import { certificateFieldValue, isBoxField, shrinkFontSize, type BoxField, type PlacedField } from "./certificate-fields";
import type { OfferingType } from "~/education/lib/offering-type";

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

export function fieldValues(cert: Pick<CertificateData, "studentName" | "offeringTitle" | "startsAt" | "endsAt" | "instructorNames" | "issuedAt">): Parameters<typeof certificateFieldValue>[1] {
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

type Measurer = Pick<InstanceType<typeof PDFDocument>, "font" | "fontSize" | "widthOfString">;

function boxFontSize(doc: Measurer, f: BoxField, text: string, bgWidth: number): number {
  doc.font(f.bold ? "Helvetica-Bold" : "Helvetica").fontSize(f.fontSize);
  if (f.fit !== "shrink") return f.fontSize;
  return shrinkFontSize(f.fontSize, f.w * bgWidth, doc.widthOfString(text));
}

/** The size each field draws at, in field order: shrink fields scaled to fit their box, all others as set. */
export function templateFieldSizes(
  fields: PlacedField[],
  values: Parameters<typeof certificateFieldValue>[1],
  bgWidth: number,
): number[] {
  const doc = new PDFDocument({ size: [bgWidth, bgWidth], margin: 0 });
  doc.on("data", () => {});
  const sizes = fields.map((f) => {
    const text = certificateFieldValue(f.key, values);
    return isBoxField(f) && text ? boxFontSize(doc, f, text, bgWidth) : f.fontSize;
  });
  doc.end();
  return sizes;
}

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
      const py = f.y * t.bgHeight;
      const height = t.bgHeight - py;
      if (isBoxField(f)) {
        const size = boxFontSize(doc, f, text, t.bgWidth);
        doc.fontSize(size).fillColor(f.color);
        doc.text(text, f.x * t.bgWidth, py, { width: f.w * t.bgWidth, align: f.align, height });
        continue;
      }
      doc
        .font(f.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(f.fontSize)
        .fillColor(f.color);
      const w = doc.widthOfString(text);
      const px = f.x * t.bgWidth;
      const x = f.align === "center" ? px - w / 2 : f.align === "right" ? px - w : px;
      doc.text(text, x, py, { lineBreak: false, height });
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
