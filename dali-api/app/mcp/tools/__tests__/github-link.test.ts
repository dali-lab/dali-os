import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/projects/lib/github-task-sync", () => ({
  normalizeRepo: (s: string) => (s.includes("/") ? s : null),
  createIssueForTask: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { createIssueForTask } from "~/projects/lib/github-task-sync";
import {
  runLinkTaskToGithub,
  LINK_TASK_TO_GITHUB_TOOL,
} from "~/mcp/tools/link-task-to-github";
import {
  runUnlinkTaskFromGithub,
  UNLINK_TASK_FROM_GITHUB_TOOL,
} from "~/mcp/tools/unlink-task-from-github";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("github link / unlink", () => {
  it("scopes are right", () => {
    expect(LINK_TASK_TO_GITHUB_TOOL.requiredScope).toBe("mcp:write");
    expect(UNLINK_TASK_FROM_GITHUB_TOOL.requiredScope).toBe("mcp:write");
  });

  it("link rejects when already linked", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      githubIssueNumber: 5,
      project: { repoUrls: ["dali/alpha"] },
    });
    await expect(
      runLinkTaskToGithub("u1", { taskId: "t1", repo: "dali/alpha" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("link rejects a repo not in project.repoUrls", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      githubIssueNumber: null,
      project: { repoUrls: ["dali/alpha"] },
    });
    await expect(
      runLinkTaskToGithub("u1", { taskId: "t1", repo: "other/repo" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("link queues a create-issue when allowed", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      githubIssueNumber: null,
      project: { repoUrls: ["dali/alpha"] },
    });
    const out = await runLinkTaskToGithub("u1", { taskId: "t1", repo: "dali/alpha" });
    expect(out).toMatchObject({ taskId: "t1", queued: true });
    expect(createIssueForTask).toHaveBeenCalledWith("t1", "dali/alpha");
  });

  it("unlink noops when not linked", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      githubIssueNumber: null,
      githubRepo: null,
      githubIssueUrl: null,
    });
    const out = await runUnlinkTaskFromGithub("u1", { taskId: "t1" });
    expect(out).toMatchObject({ noop: true });
  });

  it("unlink clears fields when linked", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      githubIssueNumber: 42,
      githubRepo: "dali/alpha",
      githubIssueUrl: "https://github.com/dali/alpha/issues/42",
    });
    mockPrisma.task.update.mockResolvedValue({});
    const out = await runUnlinkTaskFromGithub("u1", { taskId: "t1" });
    expect(out).toMatchObject({ previousRepo: "dali/alpha", previousIssueNumber: 42 });
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { githubRepo: null, githubIssueNumber: null, githubIssueUrl: null },
    });
  });
});
