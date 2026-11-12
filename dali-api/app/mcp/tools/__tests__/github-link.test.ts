import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/projects/lib/github-task-sync", () => ({
  normalizeRepo: (s: string) => (s.includes("/") ? s : null),
  createIssueForTask: vi.fn().mockResolvedValue(undefined),
  unlinkTaskFromGithub: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { createIssueForTask, unlinkTaskFromGithub } from "~/projects/lib/github-task-sync";
import {
  runLinkTaskToGithub,
} from "~/mcp/tools/link-task-to-github";
import {
  runUnlinkTaskFromGithub,
} from "~/mcp/tools/unlink-task-from-github";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("github link / unlink", () => {
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
    vi.mocked(unlinkTaskFromGithub).mockResolvedValue({ noop: true });
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
    vi.mocked(unlinkTaskFromGithub).mockResolvedValue({
      noop: false,
      previousRepo: "dali/alpha",
      previousIssueNumber: 42,
    });
    const out = await runUnlinkTaskFromGithub("u1", { taskId: "t1" });
    expect(out).toEqual({ ok: true, taskId: "t1", previousRepo: "dali/alpha", previousIssueNumber: 42 });
    expect(unlinkTaskFromGithub).toHaveBeenCalledWith("t1");
  });
});
