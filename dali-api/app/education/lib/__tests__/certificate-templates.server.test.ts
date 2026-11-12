import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => {
  const model = (...names: string[]) => Object.fromEntries(names.map((n) => [n, vi.fn()]));
  return {
    prisma: {
      projectFile: model("findFirst", "create", "update"),
      projectFileVersion: model("create"),
      certificateTemplate: model("findFirst", "findMany", "create", "update", "updateMany"),
      educationCertificateBinding: model("findUnique", "deleteMany", "upsert"),
      $transaction: vi.fn(),
    },
  };
});
vi.mock("~/lib/s3", () => ({ getObjectBytes: vi.fn(), getDownloadUrl: vi.fn() }));
vi.mock("~/drive/lib/drive-receivers.server", () => ({
  resolveFilingFolder: vi.fn(),
  singletonSlot: vi.fn((scope: string, name: string) => ({ scope, name })),
}));

import { prisma } from "~/lib/db.server";
import { getObjectBytes, getDownloadUrl } from "~/lib/s3";
import { resolveFilingFolder } from "~/drive/lib/drive-receivers.server";
import {
  getCertificateTemplateBgUrl,
  listCertificateTemplates,
  getCertificateTemplate,
  createCertificateTemplate,
  saveCertificateTemplateFields,
  renameCertificateTemplate,
  archiveCertificateTemplate,
  setDefaultCertificateTemplate,
  clearDefaultCertificateTemplate,
  bindOfferingCertificateTemplate,
  getOfferingCertificateBinding,
  resolveCertificateTemplateId,
  getCertificateRenderTemplate,
  getCertificateWebTemplate,
} from "~/education/lib/certificate-templates.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

const NOT_FOUND = { error: "Template not found", status: 404 };

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(mockPrisma)
      : Promise.all(arg as Promise<unknown>[]),
  );
});

function templateExists(exists: boolean) {
  mockPrisma.certificateTemplate.findFirst.mockResolvedValue(exists ? { id: "t1" } : null);
}

describe("background resolution", () => {
  it("getCertificateTemplateBgUrl presigns the current version inline, defaulting to image/png", async () => {
    mockPrisma.projectFile.findFirst.mockResolvedValue({
      currentVersion: { s3Key: "uploads/bg.png", contentType: null },
    });
    vi.mocked(getDownloadUrl).mockResolvedValue("https://s3/bg");
    expect(await getCertificateTemplateBgUrl("f1")).toBe("https://s3/bg");
    expect(getDownloadUrl).toHaveBeenCalledWith("uploads/bg.png", {
      contentType: "image/png",
      inline: true,
    });
    expect(mockPrisma.projectFile.findFirst.mock.calls[0][0].where).toEqual({
      id: "f1",
      archivedAt: null,
    });
  });

  it("returns null when the file is archived or has no version", async () => {
    mockPrisma.projectFile.findFirst.mockResolvedValue(null);
    expect(await getCertificateTemplateBgUrl("f1")).toBeNull();
    mockPrisma.projectFile.findFirst.mockResolvedValue({ currentVersion: null });
    expect(await getCertificateTemplateBgUrl("f1")).toBeNull();
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });
});

describe("listCertificateTemplates", () => {
  it("lists non-archived templates default-first and counts only valid fields", async () => {
    const createdAt = new Date("2026-09-01T00:00:00Z");
    mockPrisma.certificateTemplate.findMany.mockResolvedValue([
      {
        id: "t1",
        name: "Main",
        isDefault: true,
        createdAt,
        fields: [{ key: "studentName" }, { key: "bogus" }, null, { key: "issuedDate" }],
      },
    ]);
    const out = await listCertificateTemplates();
    const q = mockPrisma.certificateTemplate.findMany.mock.calls[0][0];
    expect(q.where).toEqual({ archivedAt: null });
    expect(q.orderBy).toEqual([{ isDefault: "desc" }, { createdAt: "desc" }]);
    expect(out).toEqual([{ id: "t1", name: "Main", isDefault: true, fieldCount: 2, createdAt }]);
  });
});

describe("getCertificateTemplate", () => {
  it("returns null when archived/missing", async () => {
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue(null);
    expect(await getCertificateTemplate("t1")).toBeNull();
    expect(mockPrisma.certificateTemplate.findFirst.mock.calls[0][0].where).toEqual({
      id: "t1",
      archivedAt: null,
    });
  });

  it("parses stored fields, filling defaults", async () => {
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue({
      id: "t1",
      name: "Main",
      backgroundFileId: "f1",
      bgWidth: 800,
      bgHeight: 600,
      isDefault: false,
      fields: [{ key: "studentName" }, { key: "nope" }],
    });
    const t = await getCertificateTemplate("t1");
    expect(t?.fields).toEqual([
      { key: "studentName", x: 0.5, y: 0.5, fontSize: 24, color: "#1c2b4a", align: "center", bold: false },
    ]);
  });
});

describe("createCertificateTemplate", () => {
  const valid = {
    name: "  Main  ",
    s3Key: "uploads/bg.png",
    fileName: "bg.png",
    contentType: "image/png",
    sizeBytes: 1234,
    bgWidth: 800.4,
    bgHeight: 600.6,
    actorId: "U-Ada",
  };

  it.each([
    [{ name: "   " }, "Name is required"],
    [{ s3Key: "other/bg.png" }, "Invalid background image"],
    [{ bgWidth: 0 }, "Background dimensions are required"],
    [{ bgHeight: -5 }, "Background dimensions are required"],
    [{ bgWidth: NaN }, "Background dimensions are required"],
  ])("rejects %o", async (override, error) => {
    expect(await createCertificateTemplate({ ...valid, ...override })).toEqual({ error, status: 400 });
    expect(resolveFilingFolder).not.toHaveBeenCalled();
    expect(mockPrisma.certificateTemplate.create).not.toHaveBeenCalled();
  });

  it("files the background in Drive, then creates the template with rounded dimensions", async () => {
    vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "folder-1" } as never);
    mockPrisma.projectFile.create.mockResolvedValue({ id: "file-1" });
    mockPrisma.projectFileVersion.create.mockResolvedValue({ id: "ver-1" });
    mockPrisma.projectFile.update.mockResolvedValue({});
    mockPrisma.certificateTemplate.create.mockResolvedValue({ id: "t9" });

    expect(await createCertificateTemplate(valid)).toEqual({ id: "t9" });

    expect(resolveFilingFolder).toHaveBeenCalledWith(
      { scope: "Core", name: "CertificateBackgrounds" },
      "U-Ada",
    );
    expect(mockPrisma.projectFile.create.mock.calls[0][0].data).toEqual({
      workspaceType: "Lab",
      workspaceId: null,
      folderPageId: "folder-1",
      title: "bg.png",
    });
    expect(mockPrisma.projectFileVersion.create.mock.calls[0][0].data).toEqual({
      fileId: "file-1",
      s3Key: "uploads/bg.png",
      fileName: "bg.png",
      contentType: "image/png",
      sizeBytes: 1234,
      uploadedById: "U-Ada",
    });
    expect(mockPrisma.projectFile.update).toHaveBeenCalledWith({
      where: { id: "file-1" },
      data: { currentVersionId: "ver-1" },
    });
    expect(mockPrisma.certificateTemplate.create.mock.calls[0][0].data).toEqual({
      name: "Main",
      backgroundFileId: "file-1",
      bgWidth: 800,
      bgHeight: 601,
      createdById: "U-Ada",
      fields: [],
    });
  });

  it("titles the Drive file with the template name when there is no file name", async () => {
    vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "folder-1" } as never);
    mockPrisma.projectFile.create.mockResolvedValue({ id: "file-1" });
    mockPrisma.projectFileVersion.create.mockResolvedValue({ id: "ver-1" });
    mockPrisma.certificateTemplate.create.mockResolvedValue({ id: "t9" });
    await createCertificateTemplate({ ...valid, fileName: "" });
    expect(mockPrisma.projectFile.create.mock.calls[0][0].data.title).toBe("Main");
  });
});

describe("saveCertificateTemplateFields", () => {
  it("404s on a missing template without writing", async () => {
    templateExists(false);
    expect(await saveCertificateTemplateFields({ id: "t1", fields: [] })).toEqual(NOT_FOUND);
    expect(mockPrisma.certificateTemplate.update).not.toHaveBeenCalled();
  });

  it("persists only fields that survive parsing", async () => {
    templateExists(true);
    await saveCertificateTemplateFields({
      id: "t1",
      fields: [
        { key: "studentName", x: 0.1, y: 0.2, fontSize: 30, color: "#000", align: "left", bold: true },
        { key: "evil" },
      ] as never,
    });
    expect(mockPrisma.certificateTemplate.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: {
        fields: [
          { key: "studentName", x: 0.1, y: 0.2, fontSize: 30, color: "#000", align: "left", bold: true },
        ],
      },
    });
  });
});

describe("renameCertificateTemplate", () => {
  it("rejects a blank name before looking up the template", async () => {
    expect(await renameCertificateTemplate({ id: "t1", name: " " })).toEqual({
      error: "Name is required",
      status: 400,
    });
    expect(mockPrisma.certificateTemplate.findFirst).not.toHaveBeenCalled();
  });

  it("404s when missing", async () => {
    templateExists(false);
    expect(await renameCertificateTemplate({ id: "t1", name: "X" })).toEqual(NOT_FOUND);
  });

  it("saves the trimmed name", async () => {
    templateExists(true);
    expect(await renameCertificateTemplate({ id: "t1", name: "  Fall  " })).toEqual({ ok: true });
    expect(mockPrisma.certificateTemplate.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { name: "Fall" },
    });
  });
});

describe("archiveCertificateTemplate", () => {
  it("404s when missing", async () => {
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue(null);
    expect(await archiveCertificateTemplate("t1")).toEqual(NOT_FOUND);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("drops bindings, archives the background, and archives the template while clearing its default flag", async () => {
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue({ backgroundFileId: "f1" });
    mockPrisma.educationCertificateBinding.deleteMany.mockResolvedValue({});
    mockPrisma.projectFile.update.mockResolvedValue({});
    mockPrisma.certificateTemplate.update.mockResolvedValue({});
    expect(await archiveCertificateTemplate("t1")).toEqual({ ok: true });
    expect(mockPrisma.educationCertificateBinding.deleteMany).toHaveBeenCalledWith({
      where: { templateId: "t1" },
    });
    const fileUpdate = mockPrisma.projectFile.update.mock.calls[0][0];
    expect(fileUpdate.where).toEqual({ id: "f1" });
    expect(fileUpdate.data.archivedAt).toBeInstanceOf(Date);
    const tUpdate = mockPrisma.certificateTemplate.update.mock.calls[0][0];
    expect(tUpdate.where).toEqual({ id: "t1" });
    expect(tUpdate.data.archivedAt).toBeInstanceOf(Date);
    expect(tUpdate.data.isDefault).toBe(false);
  });
});

describe("default template", () => {
  it("setDefault 404s on a missing template", async () => {
    templateExists(false);
    expect(await setDefaultCertificateTemplate("t1")).toEqual(NOT_FOUND);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("setDefault clears every other default and sets this one", async () => {
    templateExists(true);
    mockPrisma.certificateTemplate.updateMany.mockResolvedValue({});
    mockPrisma.certificateTemplate.update.mockResolvedValue({});
    expect(await setDefaultCertificateTemplate("t1")).toEqual({ ok: true });
    expect(mockPrisma.certificateTemplate.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true, id: { not: "t1" } },
      data: { isDefault: false },
    });
    expect(mockPrisma.certificateTemplate.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { isDefault: true },
    });
  });

  it("clearDefault unsets all defaults", async () => {
    mockPrisma.certificateTemplate.updateMany.mockResolvedValue({});
    expect(await clearDefaultCertificateTemplate()).toEqual({ ok: true });
    expect(mockPrisma.certificateTemplate.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  });
});

describe("bindOfferingCertificateTemplate", () => {
  it("clears the binding when templateId is null, without checking templates", async () => {
    expect(await bindOfferingCertificateTemplate({ offeringId: "o1", templateId: null })).toEqual({ ok: true });
    expect(mockPrisma.educationCertificateBinding.deleteMany).toHaveBeenCalledWith({
      where: { offeringId: "o1" },
    });
    expect(mockPrisma.certificateTemplate.findFirst).not.toHaveBeenCalled();
  });

  it("refuses to bind a missing or archived template", async () => {
    templateExists(false);
    expect(await bindOfferingCertificateTemplate({ offeringId: "o1", templateId: "t1" })).toEqual(NOT_FOUND);
    expect(mockPrisma.educationCertificateBinding.upsert).not.toHaveBeenCalled();
  });

  it("upserts one binding per offering", async () => {
    templateExists(true);
    expect(await bindOfferingCertificateTemplate({ offeringId: "o1", templateId: "t1" })).toEqual({ ok: true });
    expect(mockPrisma.educationCertificateBinding.upsert).toHaveBeenCalledWith({
      where: { offeringId: "o1" },
      create: { offeringId: "o1", templateId: "t1" },
      update: { templateId: "t1" },
    });
  });
});

describe("getOfferingCertificateBinding", () => {
  it("returns the bound template id or null", async () => {
    mockPrisma.educationCertificateBinding.findUnique.mockResolvedValue({ templateId: "t1" });
    expect(await getOfferingCertificateBinding("o1")).toBe("t1");
    mockPrisma.educationCertificateBinding.findUnique.mockResolvedValue(null);
    expect(await getOfferingCertificateBinding("o1")).toBeNull();
  });
});

describe("resolveCertificateTemplateId", () => {
  it("uses the offering's binding when that template is live", async () => {
    mockPrisma.educationCertificateBinding.findUnique.mockResolvedValue({ templateId: "bound" });
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue({ id: "bound" });
    expect(await resolveCertificateTemplateId("o1")).toBe("bound");
    expect(mockPrisma.certificateTemplate.findFirst).toHaveBeenCalledTimes(1);
    expect(mockPrisma.certificateTemplate.findFirst.mock.calls[0][0].where).toEqual({
      id: "bound",
      archivedAt: null,
    });
  });

  it("falls back to the lab default when the bound template is archived", async () => {
    mockPrisma.educationCertificateBinding.findUnique.mockResolvedValue({ templateId: "bound" });
    mockPrisma.certificateTemplate.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "default" });
    expect(await resolveCertificateTemplateId("o1")).toBe("default");
    expect(mockPrisma.certificateTemplate.findFirst.mock.calls[1][0].where).toEqual({
      isDefault: true,
      archivedAt: null,
    });
  });

  it("uses the lab default when there is no binding", async () => {
    mockPrisma.educationCertificateBinding.findUnique.mockResolvedValue(null);
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue({ id: "default" });
    expect(await resolveCertificateTemplateId("o1")).toBe("default");
  });

  it("is null (built-in design) with no binding and no default", async () => {
    mockPrisma.educationCertificateBinding.findUnique.mockResolvedValue(null);
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue(null);
    expect(await resolveCertificateTemplateId("o1")).toBeNull();
  });
});

describe("getCertificateRenderTemplate", () => {
  const row = { backgroundFileId: "f1", bgWidth: 800, bgHeight: 600, fields: [{ key: "issuedDate" }] };

  it("returns null for a missing template or a missing background", async () => {
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue(null);
    expect(await getCertificateRenderTemplate("t1")).toBeNull();
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue(row);
    mockPrisma.projectFile.findFirst.mockResolvedValue(null);
    expect(await getCertificateRenderTemplate("t1")).toBeNull();
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("returns bytes, dimensions and parsed fields, preferring the stored content type", async () => {
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue(row);
    mockPrisma.projectFile.findFirst.mockResolvedValue({
      currentVersion: { s3Key: "uploads/bg.jpg", contentType: "image/jpeg" },
    });
    const body = Buffer.from("img");
    vi.mocked(getObjectBytes).mockResolvedValue({ body, contentType: "image/png" } as never);
    const out = await getCertificateRenderTemplate("t1");
    expect(getObjectBytes).toHaveBeenCalledWith("uploads/bg.jpg");
    expect(out).toMatchObject({ bgWidth: 800, bgHeight: 600, background: body, contentType: "image/png" });
    expect(out?.fields).toHaveLength(1);
  });

  it("falls back to the version content type, and to null when S3 fails", async () => {
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue(row);
    mockPrisma.projectFile.findFirst.mockResolvedValue({
      currentVersion: { s3Key: "uploads/bg.jpg", contentType: "image/jpeg" },
    });
    vi.mocked(getObjectBytes).mockResolvedValueOnce({ body: Buffer.from("x"), contentType: undefined } as never);
    expect((await getCertificateRenderTemplate("t1"))?.contentType).toBe("image/jpeg");
    vi.mocked(getObjectBytes).mockRejectedValueOnce(new Error("S3"));
    expect(await getCertificateRenderTemplate("t1")).toBeNull();
  });
});

describe("getCertificateWebTemplate", () => {
  const row = { backgroundFileId: "f1", bgWidth: 800, bgHeight: 600, fields: [] };

  it("returns null for a missing template or background", async () => {
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue(null);
    expect(await getCertificateWebTemplate("t1")).toBeNull();
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue(row);
    mockPrisma.projectFile.findFirst.mockResolvedValue(null);
    expect(await getCertificateWebTemplate("t1")).toBeNull();
  });

  it("returns a presigned inline background URL with dimensions", async () => {
    mockPrisma.certificateTemplate.findFirst.mockResolvedValue(row);
    mockPrisma.projectFile.findFirst.mockResolvedValue({
      currentVersion: { s3Key: "uploads/bg.png", contentType: "image/png" },
    });
    vi.mocked(getDownloadUrl).mockResolvedValue("https://s3/bg");
    expect(await getCertificateWebTemplate("t1")).toEqual({
      bgUrl: "https://s3/bg",
      bgWidth: 800,
      bgHeight: 600,
      fields: [],
    });
    expect(getDownloadUrl).toHaveBeenCalledWith("uploads/bg.png", {
      contentType: "image/png",
      inline: true,
    });
  });
});
