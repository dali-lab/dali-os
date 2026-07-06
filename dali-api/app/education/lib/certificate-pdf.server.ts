import PDFDocument from "pdfkit";
import { formatDateShort } from "~/lib/display";

// A fixed one-page landscape certificate. Deliberately its own small pdfkit
// layout (not the ProseMirror export pipeline) — a certificate is a designed
// artifact, not a document render.

export function renderCertificatePdf(cert: {
  studentName: string;
  offeringTitle: string;
  offeringType: "Miniseries" | "Workshop";
  startsAt: Date;
  endsAt: Date;
  instructorNames: string[];
  issuedAt: Date;
}): Promise<Buffer> {
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
      `${formatDateShort(cert.startsAt)} – ${formatDateShort(cert.endsAt)}`,
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
