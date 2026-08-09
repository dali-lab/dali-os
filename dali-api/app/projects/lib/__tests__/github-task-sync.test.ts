import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { __setGitHubClientForTests } from "~/lib/github";
import {
  createIssueForTask,
  syncIssueForTask,
  closeIssueForTask,
  normalizeRepo,
  markRecentOutbound,
  wasRecentOutbound,
} from "~/projects/lib/github-task-sync";
import type { Octokit } from "@octokit/rest";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

type IssueOps = {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  addAssignees: ReturnType<typeof vi.fn>;
  removeAssignees: ReturnType<typeof vi.fn>;
  listLabelsOnIssue: ReturnType<typeof vi.fn>;
  removeLabel: ReturnType<typeof vi.fn>;
  addLabels: ReturnType<typeof vi.fn>;
  listComments: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
};

function fakeOctokit(): { client: Octokit; issues: IssueOps } {
  const issues: IssueOps = {
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({ data: { assignees: [] } }),
    addAssignees: vi.fn().mockResolvedValue({}),
    removeAssignees: vi.fn().mockResolvedValue({}),
    listLabelsOnIssue: vi.fn().mockResolvedValue({ data: [] }),
    removeLabel: vi.fn().mockResolvedValue({}),
    addLabels: vi.fn().mockResolvedValue({}),
    listComments: vi.fn().mockResolvedValue({ data: [] }),
    createComment: vi.fn().mockResolvedValue({}),
  };
  const client = { rest: { issues } } as unknown as Octokit;
  return { client, issues };
}

// Detail/relation fields loadTask selects for the issue body. Individual tests
// override what they need to assert on; these defaults keep buildIssueBody from
// throwing on the fields it always reads (e.g. project.name).
const taskDetail = {
  description: null as string | null,
  priority: "Normal",
  dueAt: null as Date | null,
  sprint: null as { name: string } | null,
  epic: null as { title: string } | null,
  domain: null as { displayName: string } | null,
  project: { name: "Signup Revamp" },
};

beforeEach(() => {
  mockPrisma.task = { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) };
});

afterEach(() => {
  __setGitHubClientForTests(null);
});

describe("normalizeRepo", () => {
  it.each([
    ["https://github.com/dali-lab/dali-os", "dali-lab/dali-os"],
    ["https://github.com/dali-lab/dali-os.git", "dali-lab/dali-os"],
    ["git@github.com:dali-lab/dali-os.git", "dali-lab/dali-os"],
    ["dali-lab/dali-os", "dali-lab/dali-os"],
    ["dali-lab/dali-os/", "dali-lab/dali-os"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(normalizeRepo(input)).toBe(expected);
  });

  it.each(["", "not-a-repo", "too/many/slashes", "https://example.com/no-path"])(
    "rejects %s",
    (input) => {
      expect(normalizeRepo(input)).toBeNull();
    },
  );
});

describe("loop suppression", () => {
  it("marks and detects a recent outbound write", () => {
    markRecentOutbound("dali-lab/dali-os", 42);
    expect(wasRecentOutbound("dali-lab/dali-os", 42)).toBe(true);
    expect(wasRecentOutbound("dali-lab/dali-os", 43)).toBe(false);
  });
});

describe("createIssueForTask", () => {
  it("creates an issue, persists the link, and applies the status label", async () => {
    const { client, issues } = fakeOctokit();
    __setGitHubClientForTests(client);
    issues.create.mockResolvedValue({
      data: { number: 7, html_url: "https://github.com/o/r/issues/7" },
    });

    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      projectId: "p1",
      title: "Wire signup form",
      description: "Hook the form up to the API",
      priority: "High",
      dueAt: new Date("2026-07-30T00:00:00Z"),
      status: "Todo",
      githubRepo: null,
      githubIssueNumber: null,
      sprint: { name: "Sprint 3" },
      epic: { title: "Onboarding" },
      domain: { displayName: "Dev" },
      project: { name: "Signup Revamp" },
      assignees: [
        { user: { firstName: "Ada", lastName: "L", githubUsername: "ada" } },
      ],
    });

    await createIssueForTask("t1", "o/r");

    expect(issues.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "o",
        repo: "r",
        title: "Wire signup form",
        assignees: ["ada"],
      }),
    );
    // Body carries the description, a metadata line, and the dalios backlink.
    const createdBody = (issues.create.mock.calls[0][0] as { body: string }).body;
    expect(createdBody).toContain("Hook the form up to the API");
    expect(createdBody).toContain("**Priority:** High");
    expect(createdBody).toContain("**Due:** 2026-07-30");
    expect(createdBody).toContain("**Sprint:** Sprint 3");
    expect(createdBody).toContain("**Epic:** Onboarding");
    expect(createdBody).toContain("**Domain:** Dev");
    expect(createdBody).toContain("**Project:** Signup Revamp");
    expect(createdBody).toContain("Tracked in dalios: ");
    expect(createdBody).toContain("/projects/p1?tab=board&task=t1");
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: {
        githubRepo: "o/r",
        githubIssueNumber: 7,
        githubIssueUrl: "https://github.com/o/r/issues/7",
        activityAt: expect.any(Date),
      },
    });
    expect(issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["status:todo"] }),
    );
  });

  it("posts a missing-assignees comment when an assignee has no githubUsername", async () => {
    const { client, issues } = fakeOctokit();
    __setGitHubClientForTests(client);
    issues.create.mockResolvedValue({
      data: { number: 8, html_url: "https://github.com/o/r/issues/8" },
    });

    mockPrisma.task.findUnique.mockResolvedValue({
      ...taskDetail,
      id: "t2",
      projectId: "p1",
      title: "Design hero",
      status: "Todo",
      githubRepo: null,
      githubIssueNumber: null,
      assignees: [
        { user: { firstName: "Ada", lastName: "L", githubUsername: "ada" } },
        { user: { firstName: "Bea", lastName: "M", githubUsername: null } },
      ],
    });

    await createIssueForTask("t2", "o/r");

    expect(issues.create).toHaveBeenCalledWith(
      expect.objectContaining({ assignees: ["ada"] }),
    );
    expect(issues.createComment).toHaveBeenCalledTimes(1);
    const body = (issues.createComment.mock.calls[0][0] as { body: string }).body;
    expect(body).toContain("Bea M");
    expect(body).toContain("<!-- dalios:missing-assignees:");
  });

  it("returns the mirror fields on success", async () => {
    const { client, issues } = fakeOctokit();
    __setGitHubClientForTests(client);
    issues.create.mockResolvedValue({
      data: { number: 12, html_url: "https://github.com/o/r/issues/12" },
    });

    mockPrisma.task.findUnique.mockResolvedValue({
      ...taskDetail,
      id: "t4",
      projectId: "p1",
      title: "x",
      status: "Todo",
      githubRepo: null,
      githubIssueNumber: null,
      assignees: [],
    });

    const result = await createIssueForTask("t4", "o/r");

    expect(result).toEqual({
      githubRepo: "o/r",
      githubIssueNumber: 12,
      githubIssueUrl: "https://github.com/o/r/issues/12",
    });
  });

  it("returns null (and doesn't link) when the GitHub create fails", async () => {
    const { client, issues } = fakeOctokit();
    __setGitHubClientForTests(client);
    issues.create.mockRejectedValue(new Error("boom"));

    mockPrisma.task.findUnique.mockResolvedValue({
      ...taskDetail,
      id: "t5",
      projectId: "p1",
      title: "x",
      status: "Todo",
      githubRepo: null,
      githubIssueNumber: null,
      assignees: [],
    });

    const result = await createIssueForTask("t5", "o/r");

    expect(result).toBeNull();
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("skips when the task already has a linked issue (re-fire safety)", async () => {
    const { client, issues } = fakeOctokit();
    __setGitHubClientForTests(client);
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t3",
      projectId: "p1",
      title: "x",
      status: "Todo",
      githubRepo: "o/r",
      githubIssueNumber: 1,
      assignees: [],
    });

    await createIssueForTask("t3", "o/r");

    expect(issues.create).not.toHaveBeenCalled();
  });
});

describe("syncIssueForTask", () => {
  it("updates title, reopens, and swaps the status label", async () => {
    const { client, issues } = fakeOctokit();
    __setGitHubClientForTests(client);
    issues.get.mockResolvedValue({
      data: { assignees: [{ login: "old-user" }] },
    });
    issues.listLabelsOnIssue.mockResolvedValue({
      data: [{ name: "status:todo" }],
    });

    mockPrisma.task.findUnique.mockResolvedValue({
      ...taskDetail,
      id: "t1",
      projectId: "p1",
      title: "New title",
      description: "Refreshed details",
      status: "InProgress",
      githubRepo: "o/r",
      githubIssueNumber: 9,
      assignees: [
        { user: { firstName: "Ada", lastName: "L", githubUsername: "ada" } },
      ],
    });

    await syncIssueForTask("t1");

    // The sync rewrites title, state, and the body (with the current description).
    expect(issues.update).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New title",
        state: "open",
        body: expect.stringContaining("Refreshed details"),
      }),
    );
    // Removed the old assignee and added the new one.
    expect(issues.removeAssignees).toHaveBeenCalledWith(
      expect.objectContaining({ assignees: ["old-user"] }),
    );
    expect(issues.addAssignees).toHaveBeenCalledWith(
      expect.objectContaining({ assignees: ["ada"] }),
    );
    // Swapped the label.
    expect(issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "status:todo" }),
    );
    expect(issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["status:in-progress"] }),
    );
  });

  it("clears the task's GH link when the issue is gone on GitHub (404)", async () => {
    const { client, issues } = fakeOctokit();
    __setGitHubClientForTests(client);
    issues.get.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));

    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      projectId: "p1",
      title: "x",
      status: "Todo",
      githubRepo: "o/r",
      githubIssueNumber: 9,
      assignees: [],
    });

    await syncIssueForTask("t1");

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { githubRepo: null, githubIssueNumber: null, githubIssueUrl: null },
    });
  });
});

describe("closeIssueForTask", () => {
  it("closes the issue with the right state_reason for Done", async () => {
    const { client, issues } = fakeOctokit();
    __setGitHubClientForTests(client);

    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      projectId: "p1",
      title: "x",
      status: "Done",
      githubRepo: "o/r",
      githubIssueNumber: 9,
      assignees: [],
    });

    await closeIssueForTask("t1", "completed");

    expect(issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ state: "closed", state_reason: "completed" }),
    );
  });

  it("closes the issue with not_planned for Cancelled", async () => {
    const { client, issues } = fakeOctokit();
    __setGitHubClientForTests(client);

    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      projectId: "p1",
      title: "x",
      status: "Cancelled",
      githubRepo: "o/r",
      githubIssueNumber: 9,
      assignees: [],
    });

    await closeIssueForTask("t1", "not_planned");

    expect(issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ state: "closed", state_reason: "not_planned" }),
    );
  });
});
