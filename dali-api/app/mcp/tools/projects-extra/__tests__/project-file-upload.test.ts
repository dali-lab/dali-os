import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});
vi.mock("~/lib/s3", () => ({
  getUploadPost: vi.fn(),
  headObject: vi.fn(),
  isS3Configured: vi.fn(() => true),
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { getUploadPost, headObject, isS3Configured } from "~/lib/s3";
import { logAuditEvent } from "~/lib/audit";
import { MAX_FILE_STORE_BYTES } from "~/lib/file-validation";
import {
  runCreateProjectFileUpload,
  runFinalizeProjectFileUpload,
} from "~/mcp/tools/projects-extra/project-file-upload";

const db = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  projectFileVersion: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const txFile = { create: vi.fn(), update: vi.fn() };
const txVersion = { create: vi.fn() };

const KEY = "uploads/project-files/p1/0b5e8f3c-1a2b-4c3d-8e9f-0123456789ab-final_deck.pdf";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(true);
  vi.mocked(isS3Configured).mockReturnValue(true);
  db.project.findUnique.mockResolvedValue({ id: "p1" });
  db.projectFileVersion.findFirst.mockResolvedValue(null);
  txFile.create.mockResolvedValue({ id: "f1" });
  txVersion.create.mockResolvedValue({ id: "v1" });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({ projectFile: txFile, projectFileVersion: txVersion }),
  );
  vi.mocked(getUploadPost).mockResolvedValue({
    url: "https://bucket.s3.amazonaws.com/",
    fields: {
      key: "set-by-test",
      "Content-Type": "application/pdf",
      Policy: "eyJleHAiOiJ9",
      "X-Amz-Signature": "abc123",
    },
  });
});

describe("create_project_file_upload", () => {
  const input = { projectId: "p1", fileName: "Final Deck.pdf", contentType: "Application/PDF" };

  it("refuses a caller who can't edit the project, before signing anything", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(false);
    await expect(runCreateProjectFileUpload("u1", input)).rejects.toMatchObject({ status: 403 });
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it("returns 404 for a project that doesn't exist", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    db.project.findUnique.mockResolvedValue(null);
    await expect(runCreateProjectFileUpload("u1", input)).rejects.toMatchObject({ status: 404 });
  });

  it("signs a 100 MB, 15-minute policy for a server-chosen key in the project's prefix", async () => {
    const res = await runCreateProjectFileUpload("u1", input);

    expect(res.key).toMatch(/^uploads\/project-files\/p1\/[0-9a-f-]{36}-Final_Deck\.pdf$/);
    expect(getUploadPost).toHaveBeenCalledWith(res.key, "application/pdf", {
      maxBytes: MAX_FILE_STORE_BYTES,
      expiresIn: 900,
    });
    expect(res.maxBytes).toBe(100 * 1024 * 1024);
    const minutes = (Date.parse(res.expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it("builds a curl command with literal policy fields and the file part last", async () => {
    const { curl } = await runCreateProjectFileUpload("u1", input);

    expect(curl.startsWith("curl -sS -w '\\nHTTP %{http_code}\\n' -X POST 'https://bucket.s3.amazonaws.com/'")).toBe(true);
    expect(curl).not.toContain("\n");
    expect(curl).toContain("--form-string 'Policy=eyJleHAiOiJ9'");
    expect(curl).toContain("--form-string 'Content-Type=application/pdf'");
    expect(curl.endsWith("-F 'file=@/path/to/Final_Deck.pdf'")).toBe(true);
  });

  it("quotes a value containing a single quote so the shell can't break out", async () => {
    vi.mocked(getUploadPost).mockResolvedValue({
      url: "https://bucket.s3.amazonaws.com/",
      fields: { "x-amz-meta-note": "it's" },
    });
    const { curl } = await runCreateProjectFileUpload("u1", input);
    expect(curl).toContain(`--form-string 'x-amz-meta-note=it'\\''s'`);
  });

  it("refuses a blocked file type", async () => {
    await expect(
      runCreateProjectFileUpload("u1", { ...input, fileName: "setup.exe", contentType: "application/octet-stream" }),
    ).rejects.toMatchObject({ status: 400, message: "File type not allowed" });
  });

  it("refuses a declared size over 100 MB up front", async () => {
    await expect(
      runCreateProjectFileUpload("u1", { ...input, sizeBytes: MAX_FILE_STORE_BYTES + 1 }),
    ).rejects.toMatchObject({ status: 400, message: "File too large (max 100 MB)" });
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5])("refuses a malformed sizeBytes (%s)", async (sizeBytes) => {
    await expect(runCreateProjectFileUpload("u1", { ...input, sizeBytes })).rejects.toMatchObject({
      status: 400,
      message: "sizeBytes must be a non-negative integer",
    });
  });

  it("accepts a declared 90 MB file", async () => {
    await expect(
      runCreateProjectFileUpload("u1", { ...input, sizeBytes: 90 * 1024 * 1024 }),
    ).resolves.toHaveProperty("key");
  });

  it("says so plainly when storage isn't configured", async () => {
    vi.mocked(isS3Configured).mockReturnValue(false);
    await expect(runCreateProjectFileUpload("u1", input)).rejects.toMatchObject({
      message: "File storage is not configured in this environment",
    });
  });
});

describe("finalize_project_file_upload", () => {
  beforeEach(() => {
    vi.mocked(headObject).mockResolvedValue({ sizeBytes: 73_400_320, contentType: "application/pdf" });
  });

  it("records the size and type storage reports, and audits the create", async () => {
    const res = await runFinalizeProjectFileUpload("u1", { projectId: "p1", key: KEY });

    expect(headObject).toHaveBeenCalledWith(KEY);
    expect(txFile.create).toHaveBeenCalledWith({
      data: { projectId: "p1", title: "final_deck.pdf" },
      select: { id: true },
    });
    expect(txVersion.create).toHaveBeenCalledWith({
      data: {
        fileId: "f1",
        s3Key: KEY,
        fileName: "final_deck.pdf",
        contentType: "application/pdf",
        sizeBytes: 73_400_320,
        uploadedById: "u1",
      },
      select: { id: true },
    });
    expect(txFile.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { currentVersionId: "v1" },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "projectFile.create", userId: "u1", targetId: "f1" }),
    );
    expect(res).toMatchObject({ fileId: "f1", sizeBytes: 73_400_320, contentType: "application/pdf" });
    expect(res.src).toBe(`/api/upload/raw?key=${encodeURIComponent(KEY)}`);
  });

  it("uses the caller's fileName and title when given", async () => {
    await runFinalizeProjectFileUpload("u1", {
      projectId: "p1",
      key: KEY,
      fileName: "Final Deck.pdf",
      title: "Final deck (v3)",
    });
    expect(txFile.create).toHaveBeenCalledWith({
      data: { projectId: "p1", title: "Final deck (v3)" },
      select: { id: true },
    });
    expect(txVersion.create.mock.calls[0][0].data.fileName).toBe("Final Deck.pdf");
  });

  it.each([
    ["another project's key", "uploads/project-files/p2/0b5e8f3c-1a2b-4c3d-8e9f-0123456789ab-x.pdf"],
    ["a non-project upload", "uploads/avatars/me.png"],
    ["a bare prefix", "uploads/project-files/p1/"],
    ["a traversal", "uploads/project-files/p1/../p2/x.pdf"],
    ["a nested path", "uploads/project-files/p1/sub/x.pdf"],
  ])("refuses %s", async (_label, key) => {
    await expect(runFinalizeProjectFileUpload("u1", { projectId: "p1", key })).rejects.toMatchObject({
      status: 400,
    });
    expect(headObject).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a caller who can't edit the project", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(false);
    await expect(runFinalizeProjectFileUpload("u1", { projectId: "p1", key: KEY })).rejects.toMatchObject({
      status: 403,
    });
    expect(headObject).not.toHaveBeenCalled();
  });

  it("returns 404 with a next step when nothing was uploaded", async () => {
    vi.mocked(headObject).mockResolvedValue(null);
    await expect(runFinalizeProjectFileUpload("u1", { projectId: "p1", key: KEY })).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("HTTP 204"),
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("returns the existing file on a retry instead of adding it twice", async () => {
    db.projectFileVersion.findFirst.mockResolvedValue({ fileId: "f-existing" });
    const res = await runFinalizeProjectFileUpload("u1", { projectId: "p1", key: KEY });
    expect(res).toMatchObject({ fileId: "f-existing", alreadyFinalized: true });
    expect(headObject).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses an object over 100 MB even though the policy should have stopped it", async () => {
    vi.mocked(headObject).mockResolvedValue({ sizeBytes: MAX_FILE_STORE_BYTES + 1, contentType: "application/pdf" });
    await expect(runFinalizeProjectFileUpload("u1", { projectId: "p1", key: KEY })).rejects.toMatchObject({
      status: 400,
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a blocked file name given at finalize", async () => {
    await expect(
      runFinalizeProjectFileUpload("u1", { projectId: "p1", key: KEY, fileName: "payload.exe" }),
    ).rejects.toMatchObject({ status: 400, message: "File type not allowed" });
  });

  it("finalizes the exact key create minted, even for a name with '..' in it", async () => {
    const { key } = await runCreateProjectFileUpload("u1", {
      projectId: "p1",
      fileName: "draft..final.pdf",
      contentType: "application/pdf",
    });
    const res = await runFinalizeProjectFileUpload("u1", { projectId: "p1", key });
    expect(res).toMatchObject({ fileId: "f1", key });
    expect(txVersion.create.mock.calls[0][0].data.fileName).toBe("draft..final.pdf");
  });

  it("defaults the file name to the whole segment when the key has no uuid", async () => {
    await runFinalizeProjectFileUpload("u1", { projectId: "p1", key: "uploads/project-files/p1/report.pdf" });
    expect(txVersion.create.mock.calls[0][0].data.fileName).toBe("report.pdf");
  });

  it("refuses an object whose stored type is blocked, whatever the name", async () => {
    vi.mocked(headObject).mockResolvedValue({ sizeBytes: 10, contentType: "application/x-msdownload" });
    await expect(runFinalizeProjectFileUpload("u1", { projectId: "p1", key: KEY })).rejects.toMatchObject({
      status: 400,
      message: "File type not allowed",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("points at the POST when storage can't find the key (403 without ListBucket)", async () => {
    vi.mocked(headObject).mockRejectedValue(Object.assign(new Error("Forbidden"), { name: "Unknown" }));
    await expect(runFinalizeProjectFileUpload("u1", { projectId: "p1", key: KEY })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("HTTP 204"),
    });
  });

  it("maps an unconfigured bucket to a plain message", async () => {
    vi.mocked(headObject).mockRejectedValue(new Error("AWS S3 is not configured"));
    await expect(runFinalizeProjectFileUpload("u1", { projectId: "p1", key: KEY })).rejects.toMatchObject({
      message: "File storage is not configured in this environment",
    });
  });
});
