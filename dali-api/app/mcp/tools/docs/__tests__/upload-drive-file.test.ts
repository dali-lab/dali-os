import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    projectFile: {
      create: vi.fn(),
      update: vi.fn(),
    },
    projectFileVersion: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("~/lib/roles", () => ({
  isLabMember: vi.fn(),
}));

vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { isLabMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import {
  UPLOAD_DRIVE_FILE_TOOL,
  runUploadDriveFile,
  UploadDriveFileError,
} from "~/mcp/tools/docs/upload-drive-file";

const mockPrisma = prisma as unknown as {
  $transaction: ReturnType<typeof vi.fn>;
};

const BASE_INPUT = {
  s3Key: "uploads/test.pdf",
  title: "Test File",
  fileName: "test.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: $transaction calls the callback with a transaction proxy that returns {id: "file1"}
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      projectFile: { create: vi.fn().mockResolvedValue({ id: "file1" }), update: vi.fn() },
      projectFileVersion: { create: vi.fn().mockResolvedValue({ id: "v1" }) },
    };
    return fn(tx);
  });
});

describe("upload_drive_file", () => {
  it("requires the mcp:write scope", () => {
    expect(UPLOAD_DRIVE_FILE_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects s3Key not starting with uploads/", async () => {
    await expect(
      runUploadDriveFile("u1", { ...BASE_INPUT, s3Key: "bad/path.pdf", scope: "Lab" }),
    ).rejects.toMatchObject({ name: "UploadDriveFileError", status: 400 });
  });

  it("rejects non-integer sizeBytes", async () => {
    await expect(
      runUploadDriveFile("u1", { ...BASE_INPUT, sizeBytes: 1.5, scope: "Lab" }),
    ).rejects.toMatchObject({ name: "UploadDriveFileError", status: 400 });
  });

  it("rejects Lab scope when caller is not a lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: true, canEdit: true } as never);
    await expect(
      runUploadDriveFile("u1", { ...BASE_INPUT, scope: "Lab" }),
    ).rejects.toMatchObject({ name: "UploadDriveFileError", status: 403 });
  });

  it("creates a Lab-scope file for a lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    const out = await runUploadDriveFile("u1", { ...BASE_INPUT, scope: "Lab" });
    expect(out).toEqual({ id: "file1" });
  });

  it("creates a Member-scope file for any authenticated caller", async () => {
    // No isLabMember call needed for Member scope
    const out = await runUploadDriveFile("u1", { ...BASE_INPUT, scope: "Member" });
    expect(out).toEqual({ id: "file1" });
    expect(isLabMember).not.toHaveBeenCalled();
  });

  it("rejects folder placement when caller lacks edit access to folder", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: false, canEdit: false } as never);
    await expect(
      runUploadDriveFile("u1", { ...BASE_INPUT, scope: "Lab", folderPageId: "folder1" }),
    ).rejects.toMatchObject({ name: "UploadDriveFileError", status: 403 });
  });

  it("allows Lab file with valid folder placement", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canComment: true, canEdit: true } as never);
    const out = await runUploadDriveFile("u1", { ...BASE_INPUT, scope: "Lab", folderPageId: "folder1" });
    expect(out).toEqual({ id: "file1" });
  });
});
