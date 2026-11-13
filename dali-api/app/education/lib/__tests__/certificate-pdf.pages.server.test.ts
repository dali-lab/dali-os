import { describe, expect, it } from "vitest";
import { renderCertificatePdf, type CertificateData } from "~/education/lib/certificate-pdf.server";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const cert: CertificateData = {
  studentName: "Ada Lovelace ".repeat(40),
  offeringTitle: "Design Basics",
  offeringType: "Miniseries",
  startsAt: null,
  endsAt: null,
  instructorNames: [],
  issuedAt: new Date("2026-10-20T16:00:00Z"),
};

const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page(?!s)/g) ?? []).length;

const field = (over: Record<string, unknown>) => ({ key: "studentName", x: 0.1, y: 0.98, fontSize: 30, color: "#000000", align: "left", bold: false, ...over });

describe("template PDF page count", () => {
  const render = (fields: unknown[]) =>
    renderCertificatePdf(cert, { bgWidth: 400, bgHeight: 300, background: PNG, fields: fields as never });

  it("stays on one page when a long box field starts near the bottom", async () => {
    expect(pageCount(await render([field({ w: 0.3, fit: "wrap" })]))).toBe(1);
  });

  it("stays on one page for a long legacy anchor field near the bottom", async () => {
    expect(pageCount(await render([field({})]))).toBe(1);
  });
});
