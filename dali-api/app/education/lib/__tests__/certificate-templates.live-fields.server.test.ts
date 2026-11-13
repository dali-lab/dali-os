import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    projectFile: { findFirst: vi.fn() },
    certificateTemplate: { findFirst: vi.fn() },
  },
}));
vi.mock("~/lib/s3.server", () => ({ getObjectBytes: vi.fn(), getDownloadUrl: vi.fn() }));
vi.mock("~/drive/lib/drive-receivers.server", () => ({ resolveFilingFolder: vi.fn(), singletonSlot: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { getDownloadUrl, getObjectBytes } from "~/lib/s3.server";
import { getCertificateRenderTemplate, getCertificateWebTemplate } from "~/education/lib/certificate-templates.server";

const db = prisma as unknown as {
  projectFile: { findFirst: ReturnType<typeof vi.fn> };
  certificateTemplate: { findFirst: ReturnType<typeof vi.fn> };
};
const field = { key: "studentName", x: 0.1, y: 0.2, w: 0.5, fit: "shrink", fontSize: 30, color: "#000000", align: "left", bold: false };

beforeEach(() => {
  vi.resetAllMocks();
  db.projectFile.findFirst.mockResolvedValue({ currentVersion: { s3Key: "uploads/bg.png", contentType: "image/png" } });
  vi.mocked(getObjectBytes).mockResolvedValue({ body: Buffer.from("x"), contentType: "image/png" } as never);
  vi.mocked(getDownloadUrl).mockResolvedValue("https://s3/bg");
});

describe("issued certificates follow the live template", () => {
  it("reads the template's current fields by id on every render, for the PDF and the page", async () => {
    db.certificateTemplate.findFirst.mockResolvedValueOnce({ backgroundFileId: "f", bgWidth: 800, bgHeight: 600, fields: [] });
    expect((await getCertificateRenderTemplate("t1"))?.fields).toEqual([]);

    db.certificateTemplate.findFirst.mockResolvedValueOnce({ backgroundFileId: "f", bgWidth: 800, bgHeight: 600, fields: [field] });
    expect((await getCertificateRenderTemplate("t1"))?.fields).toEqual([field]);

    db.certificateTemplate.findFirst.mockResolvedValueOnce({ backgroundFileId: "f", bgWidth: 800, bgHeight: 600, fields: [{ ...field, w: 0.9 }] });
    expect((await getCertificateWebTemplate("t1"))?.fields[0]).toMatchObject({ w: 0.9, fit: "shrink" });
    expect(db.certificateTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "t1", archivedAt: null } }));
  });
});

describe("templates whose background is not an image", () => {
  beforeEach(() => {
    db.certificateTemplate.findFirst.mockResolvedValue({ backgroundFileId: "f", bgWidth: 842, bgHeight: 595, fields: [field] });
    db.projectFile.findFirst.mockResolvedValue({ currentVersion: { s3Key: "uploads/certificate-templates/bg.pdf", contentType: "application/pdf" } });
  });

  it("fall back to the built-in design for the PDF without fetching the file", async () => {
    expect(await getCertificateRenderTemplate("t1")).toBeNull();
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("fall back to the built-in design on the certificate page without signing a link", async () => {
    expect(await getCertificateWebTemplate("t1")).toBeNull();
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });
});
