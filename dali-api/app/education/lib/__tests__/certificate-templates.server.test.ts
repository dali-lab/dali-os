import { describe, it, expect, beforeEach, vi } from "vitest";

const tx = vi.hoisted(() => ({
  projectFile: { create: vi.fn(), update: vi.fn() },
  projectFileVersion: { create: vi.fn() },
}));

vi.mock("~/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    certificateTemplate: { create: vi.fn() },
  },
}));
vi.mock("~/lib/s3", () => ({ getObjectBytes: vi.fn(), getDownloadUrl: vi.fn() }));
vi.mock("~/lib/drive-receivers.server", () => ({
  singletonSlot: (processType: string, folderType: string) => ({ processType, processId: "core", folderType }),
  resolveFilingFolder: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { resolveFilingFolder } from "~/lib/drive-receivers.server";
import { createCertificateTemplate } from "~/education/lib/certificate-templates.server";

const args = {
  name: "Completion",
  s3Key: "uploads/bg.png",
  fileName: "bg.png",
  contentType: "image/png",
  sizeBytes: 100,
  bgWidth: 800,
  bgHeight: 600,
  actorId: "u1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "bg-recv", viaReceiver: true });
  tx.projectFile.create.mockResolvedValue({ id: "file-1" });
  tx.projectFileVersion.create.mockResolvedValue({ id: "ver-1" });
  vi.mocked(prisma.certificateTemplate.create).mockResolvedValue({ id: "tpl-1" } as never);
});

describe("createCertificateTemplate", () => {
  it("files the background via the Core CertificateBackgrounds slot", async () => {
    await expect(createCertificateTemplate(args)).resolves.toEqual({ id: "tpl-1" });

    expect(resolveFilingFolder).toHaveBeenCalledWith(
      { processType: "Core", processId: "core", folderType: "CertificateBackgrounds" },
      "u1",
    );
    expect(tx.projectFile.create.mock.calls[0]![0].data).toMatchObject({
      workspaceType: "Lab",
      workspaceId: null,
      folderPageId: "bg-recv",
    });
  });

  it("files into the Core root when no receiver is marked", async () => {
    vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "core-root", viaReceiver: false });

    await createCertificateTemplate(args);

    expect(tx.projectFile.create.mock.calls[0]![0].data.folderPageId).toBe("core-root");
  });

  it("rejects a blank name, a foreign key and missing dimensions before filing anything", async () => {
    await expect(createCertificateTemplate({ ...args, name: "  " })).resolves.toMatchObject({ status: 400 });
    await expect(createCertificateTemplate({ ...args, s3Key: "other/bg.png" })).resolves.toMatchObject({ status: 400 });
    await expect(createCertificateTemplate({ ...args, bgWidth: 0 })).resolves.toMatchObject({ status: 400 });
    expect(resolveFilingFolder).not.toHaveBeenCalled();
  });
});
