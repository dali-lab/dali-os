import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { task: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("~/lib/github-webhook", () => ({ verifyGithubSignature: vi.fn() }));
vi.mock("~/projects/lib/github-task-sync", () => ({ wasRecentOutbound: () => false }));
vi.mock("~/projects/lib/task-notifications.server", () => ({
  notifyTaskGithubUpdate: vi.fn(),
  notifyTaskAssigned: vi.fn(),
  notifyTaskComment: vi.fn(),
}));
vi.mock("~/projects/lib/code-tasks.server", () => ({
  codeTaskDoneBlocker: vi.fn(),
  recordPullRequestEvent: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { codeTaskDoneBlocker, recordPullRequestEvent } from "~/projects/lib/code-tasks.server";
import { handleIssues, handlePullRequest } from "~/projects/routes/api.webhooks.github";

const repository = { full_name: "dali-lab/os" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.task.findUnique).mockResolvedValue({
    id: "t1",
    status: "InReview",
    projectId: "p1",
  } as never);
});

describe("issue closed → Done", () => {
  const close = () =>
    handleIssues({ action: "closed", issue: { number: 12, state_reason: "completed" }, repository });

  it("moves an ordinary task to Done", async () => {
    vi.mocked(codeTaskDoneBlocker).mockResolvedValue(null);
    await close();
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "Done" }) }),
    );
  });

  it("leaves a code task without a merged PR where it is", async () => {
    vi.mocked(codeTaskDoneBlocker).mockResolvedValue("needs a PR");
    await close();
    expect(codeTaskDoneBlocker).toHaveBeenCalledWith("t1");
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it("still cancels a code task closed as not planned", async () => {
    await handleIssues({
      action: "closed",
      issue: { number: 12, state_reason: "not_planned" },
      repository,
    });
    expect(codeTaskDoneBlocker).not.toHaveBeenCalled();
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "Cancelled" }) }),
    );
  });
});

describe("pull_request events", () => {
  it("records the PR with its merged state and the tasks its text references", async () => {
    await handlePullRequest({
      action: "closed",
      repository,
      pull_request: {
        number: 7,
        html_url: "https://github.com/dali-lab/os/pull/7",
        title: "Login",
        body: "Closes #12",
        state: "closed",
        merged: true,
        merged_at: "2026-10-12T00:00:00Z",
      },
    });
    expect(recordPullRequestEvent).toHaveBeenCalledWith({
      repo: "dali-lab/os",
      number: 7,
      url: "https://github.com/dali-lab/os/pull/7",
      title: "Login",
      body: "Closes #12",
      state: "merged",
      mergedAt: new Date("2026-10-12T00:00:00Z"),
      refs: { issueNumbers: [12], taskIds: [] },
    });
  });

  it("ignores malformed payloads", async () => {
    await handlePullRequest({ action: "opened", repository, pull_request: { title: "x" } });
    await handlePullRequest({ action: "opened", pull_request: { number: 1, html_url: "u" } });
    expect(recordPullRequestEvent).not.toHaveBeenCalled();
  });
});
