import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    projectFile: { findUnique: vi.fn() },
    taskFileLink: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import {
  runManageTaskFiles,
  MANAGE_TASK_FILES_TOOL,
} from "~/mcp/tools/projects-extra/manage-task-files";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
  projectFile: { findUnique: ReturnType<typeof vi.fn> };
  taskFileLink: {
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_task_files", () => {
  it("requires mcp:write scope", () => {
    expect(MANAGE_TASK_FILES_TOOL.requiredScope).toBe("mcp:write");
  });

  it("throws McpNotFoundError for unknown task", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.task.findUnique.mockResolvedValue(null);
    await expect(
      runManageTaskFiles("u1", { action: "link", taskId: "t-nope", fileId: "f1" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpForbiddenError for non-member", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", projectId: "p1" });
    await expect(
      runManageTaskFiles("u1", { action: "link", taskId: "t1", fileId: "f1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("unlinks a file (does not delete the file)", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", projectId: "p1" });
    mockPrisma.taskFileLink.deleteMany.mockResolvedValue({ count: 1 });
    const out = await runManageTaskFiles("u1", { action: "unlink", taskId: "t1", fileId: "f1" });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.taskFileLink.deleteMany).toHaveBeenCalledWith({
      where: { taskId: "t1", fileId: "f1" },
    });
  });

  it("links a file and returns metadata", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", projectId: "p1" });
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      id: "f1",
      title: "My File",
      projectId: "p1",
      archivedAt: null,
      _count: { versions: 3 },
    });
    mockPrisma.taskFileLink.createMany.mockResolvedValue({ count: 1 });
    const out = await runManageTaskFiles("u1", { action: "link", taskId: "t1", fileId: "f1" });
    expect(out).toMatchObject({ ok: true, id: "f1", title: "My File", versionCount: 3 });
  });

  it("rejects linking a file from a different project", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", projectId: "p1" });
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      id: "f1",
      title: "Other",
      projectId: "p2",
      archivedAt: null,
      _count: { versions: 1 },
    });
    await expect(
      runManageTaskFiles("u1", { action: "link", taskId: "t1", fileId: "f1" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("rejects linking an archived file", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", projectId: "p1" });
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      id: "f1",
      title: "Old",
      projectId: "p1",
      archivedAt: new Date(),
      _count: { versions: 1 },
    });
    await expect(
      runManageTaskFiles("u1", { action: "link", taskId: "t1", fileId: "f1" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});
