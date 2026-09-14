import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});
vi.mock("~/jobs/task-auto-archive.server", () => ({
  archiveTerminalTasks: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { archiveTerminalTasks } from "~/jobs/task-auto-archive.server";
import {
  runArchiveDoneTasks,
  ARCHIVE_DONE_TASKS_TOOL,
} from "~/mcp/tools/projects-extra/archive-done-tasks";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("archive_done_tasks", () => {
  it("requires mcp:write scope", () => {
    expect(ARCHIVE_DONE_TASKS_TOOL.requiredScope).toBe("mcp:write");
  });

  it("throws McpNotFoundError for unknown project", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue(null);
    await expect(
      runArchiveDoneTasks("u1", { projectId: "nope" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpForbiddenError for non-member", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    await expect(
      runArchiveDoneTasks("u1", { projectId: "p1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("archives terminal tasks and returns count", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    vi.mocked(archiveTerminalTasks).mockResolvedValue(3);

    const out = await runArchiveDoneTasks("u1", { projectId: "p1" });
    expect(out).toEqual({ archived: 3 });
    expect(archiveTerminalTasks).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1" }),
    );
  });

  it("returns 0 when nothing to archive", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    vi.mocked(archiveTerminalTasks).mockResolvedValue(0);

    const out = await runArchiveDoneTasks("u2", { projectId: "p1" });
    expect(out).toEqual({ archived: 0 });
  });
});
