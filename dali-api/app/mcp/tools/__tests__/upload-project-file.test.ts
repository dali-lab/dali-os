import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/lib/s3", () => ({
  putObject: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { putObject } from "~/lib/s3";
import {
  runUploadProjectFile,
  UploadProjectFileError,
} from "~/mcp/tools/upload-project-file";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  projectFile: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  projectFileVersion: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const PNG_BASE64 = Buffer.from("fake png bytes").toString("base64");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      projectFile: {
        create: vi.fn().mockResolvedValue({ id: "f1" }),
        update: vi.fn(),
      },
      projectFileVersion: { create: vi.fn().mockResolvedValue({ id: "v1" }) },
    }),
  );
});

describe("upload_project_file", () => {
  it("is Core-only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runUploadProjectFile("u1", {
        projectId: "p1",
        fileName: "a.png",
        contentType: "image/png",
        base64: PNG_BASE64,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects blocked executable types", async () => {
    await expect(
      runUploadProjectFile("u1", {
        projectId: "p1",
        fileName: "evil.exe",
        contentType: "application/octet-stream",
        base64: PNG_BASE64,
      }),
    ).rejects.toThrow(/not allowed/);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("pageImage purpose requires an image contentType", async () => {
    await expect(
      runUploadProjectFile("u1", {
        projectId: "p1",
        fileName: "doc.pdf",
        contentType: "application/pdf",
        base64: PNG_BASE64,
        purpose: "pageImage",
      }),
    ).rejects.toBeInstanceOf(UploadProjectFileError);
  });

  it("rejects undecodable base64", async () => {
    await expect(
      runUploadProjectFile("u1", {
        projectId: "p1",
        fileName: "a.png",
        contentType: "image/png",
        base64: "!!!!",
      }),
    ).rejects.toThrow(/base64/);
  });

  it("pageImage uploads to doc-images and returns a raw src without a Files row", async () => {
    const out = await runUploadProjectFile("u1", {
      projectId: "p1",
      fileName: "shot.png",
      contentType: "image/png",
      base64: PNG_BASE64,
      purpose: "pageImage",
    });
    expect(putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^uploads\/doc-images\/p1\//),
      expect.any(Buffer),
      "image/png",
    );
    expect(out.src).toMatch(/^\/api\/upload\/raw\?key=uploads%2Fdoc-images%2Fp1%2F/);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("file purpose registers a ProjectFile with first version", async () => {
    const out = await runUploadProjectFile("u1", {
      projectId: "p1",
      fileName: "spec.pdf",
      contentType: "application/pdf",
      base64: PNG_BASE64,
      title: "Product spec",
    });
    expect(putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^uploads\/project-files\/p1\//),
      expect.any(Buffer),
      "application/pdf",
    );
    expect(out).toMatchObject({ fileId: "f1", title: "Product spec" });
    expect(out.src).toContain("/api/upload/raw?key=");
  });

  it("404s a missing project", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);
    await expect(
      runUploadProjectFile("u1", {
        projectId: "nope",
        fileName: "a.png",
        contentType: "image/png",
        base64: PNG_BASE64,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
