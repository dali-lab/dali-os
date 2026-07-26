import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// One-page letter PDF with a large check-in QR for projecting/printing at
// an event. Deliberately its own small pdfkit layout (same pattern as
// certificate-pdf.server.ts) — not the document export pipeline.

export async function renderCheckInQrPdf(opts: {
  meetingTitle: string;
  checkInUrl: string;
}): Promise<Buffer> {
  const qrPng = await QRCode.toBuffer(opts.checkInUrl, {
    type: "png",
    margin: 1,
    width: 720,
    errorCorrectionLevel: "M",
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "portrait", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width;
    const contentWidth = width - 96;

    doc.fillColor("#1c2b4a");
    doc.font("Helvetica-Bold").fontSize(11).text("DALI LAB", 48, 48, {
      width: contentWidth,
      align: "center",
      characterSpacing: 3,
    });

    doc.font("Helvetica-Bold").fontSize(22).fillColor("#1c2b4a");
    doc.text("Self check-in", 48, 78, { width: contentWidth, align: "center" });

    doc.font("Helvetica").fontSize(14).fillColor("#333333");
    doc.text(opts.meetingTitle, 48, 112, {
      width: contentWidth,
      align: "center",
    });

    const qrSize = 360;
    const qrX = (width - qrSize) / 2;
    const qrY = 160;
    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });

    doc.font("Helvetica").fontSize(11).fillColor("#555555");
    doc.text(
      "Scan while signed in to mark yourself present.",
      48,
      qrY + qrSize + 24,
      { width: contentWidth, align: "center" },
    );

    doc.font("Helvetica").fontSize(9).fillColor("#888888");
    doc.text(opts.checkInUrl, 48, qrY + qrSize + 48, {
      width: contentWidth,
      align: "center",
      link: opts.checkInUrl,
    });

    doc.end();
  });
}
