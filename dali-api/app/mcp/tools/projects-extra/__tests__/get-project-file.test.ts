import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { projectFile: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/fileAccess.server", () => ({ canViewFile: vi.fn() }));
vi.mock("~/lib/s3", () => ({ getDownloadUrl: vi.fn().mockResolvedValue("https://signed.example/x") }));
vi.mock("~/lib/collabAuth", () => ({ hydrateAuthors: vi.fn().mockResolvedValue([]) }));

import { prisma } from "~/lib/db";
import { canViewFile } from "~/lib/fileAccess.server";
import { runGetProjectFile } from "~/mcp/tools/projects-extra/get-project-file";

const findUnique = prisma.projectFile.findUnique as unknown as ReturnType<typeof vi.fn>;

const fileRow = {
  id: "f1",
  title: "Plan",
  currentVersionId: "v1",
  archivedAt: null,
  projectId: null,
  workspaceType: "Lab",
  workspaceId: null,
  folderPageId: "folder-core",
  versions: [
    {
      id: "v1",
      fileName: "plan.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
      uploadedById: "u1",
      createdAt: new Date("2026-10-01T00:00:00Z"),
      s3Key: "k",
    },
  ],
};

describe("get_project_file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(fileRow);
  });

  it("hides a file the caller cannot view, as the web route does", async () => {
    vi.mocked(canViewFile).mockResolvedValue(false);
    await expect(runGetProjectFile("u2", { fileId: "f1" })).rejects.toThrow(/not found/i);
    expect(canViewFile).toHaveBeenCalledWith(
      "u2",
      expect.objectContaining({ workspaceType: "Lab", workspaceId: null, folderPageId: "folder-core" }),
    );
  });

  it("returns versions for a file the caller can view", async () => {
    vi.mocked(canViewFile).mockResolvedValue(true);
    const out = await runGetProjectFile("u2", { fileId: "f1" });
    expect(out).toMatchObject({ id: "f1", versions: [{ id: "v1", fileName: "plan.pdf" }] });
  });
});
