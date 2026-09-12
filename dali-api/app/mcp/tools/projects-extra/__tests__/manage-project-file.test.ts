import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    projectFile: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    projectFileVersion: {
      create: vi.fn(),
    },
  },
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});
vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/projects/lib/file-notifications.server", () => ({
  notifyFileNewVersion: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import {
  runManageProjectFile,
  MANAGE_PROJECT_FILE_TOOL,
} from "~/mcp/tools/projects-extra/manage-project-file";

const mockPrisma = prisma as unknown as {
  projectFile: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  projectFileVersion: {
    create: ReturnType<typeof vi.fn>;
  };
};

const LIVE_PROJECT_FILE = {
  id: "f1",
  archivedAt: null,
  projectId: "p1",
  workspaceType: "Project",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_project_file", () => {
  it("requires mcp:write scope", () => {
    expect(MANAGE_PROJECT_FILE_TOOL.requiredScope).toBe("mcp:write");
  });

  it("throws McpNotFoundError for unknown file", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.projectFile.findUnique.mockResolvedValue(null);
    await expect(
      runManageProjectFile("u1", { action: "rename", fileId: "nope", title: "x" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpNotFoundError for archived file", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      ...LIVE_PROJECT_FILE,
      archivedAt: new Date(),
    });
    await expect(
      runManageProjectFile("u1", { action: "rename", fileId: "f1", title: "x" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpInvalidError for non-project workspace files", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      ...LIVE_PROJECT_FILE,
      workspaceType: "Lab",
      projectId: null,
    });
    await expect(
      runManageProjectFile("u1", { action: "rename", fileId: "f1", title: "x" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpForbiddenError for non-member", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.projectFile.findUnique.mockResolvedValue(LIVE_PROJECT_FILE);
    await expect(
      runManageProjectFile("u1", { action: "rename", fileId: "f1", title: "x" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("renames a file", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.projectFile.findUnique.mockResolvedValue(LIVE_PROJECT_FILE);
    mockPrisma.projectFile.update.mockResolvedValue({});
    const out = await runManageProjectFile("u1", {
      action: "rename",
      fileId: "f1",
      title: "New Name",
    });
    expect(out).toMatchObject({ ok: true, fileId: "f1" });
    expect(mockPrisma.projectFile.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { title: "New Name" },
    });
  });

  it("rejects add_version with an invalid s3Key", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.projectFile.findUnique.mockResolvedValue(LIVE_PROJECT_FILE);
    await expect(
      runManageProjectFile("u1", {
        action: "add_version",
        fileId: "f1",
        s3Key: "bad/key",
        fileName: "doc.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("adds a new version and advances currentVersionId", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.projectFile.findUnique.mockResolvedValue(LIVE_PROJECT_FILE);
    mockPrisma.projectFileVersion.create.mockResolvedValue({ id: "v2" });
    mockPrisma.projectFile.update.mockResolvedValue({});

    const out = await runManageProjectFile("u1", {
      action: "add_version",
      fileId: "f1",
      s3Key: "uploads/abc123.pdf",
      fileName: "report.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
    });
    expect(out).toMatchObject({ ok: true, fileId: "f1", versionId: "v2" });
    expect(mockPrisma.projectFileVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileId: "f1",
          s3Key: "uploads/abc123.pdf",
          fileName: "report.pdf",
          contentType: "application/pdf",
          sizeBytes: 2048,
          uploadedById: "u1",
        }),
      }),
    );
    expect(mockPrisma.projectFile.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { currentVersionId: "v2" },
    });
  });
});
