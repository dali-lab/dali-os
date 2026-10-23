import { describe, it, expect, beforeEach, vi } from "vitest";

const pullsGet = vi.hoisted(() => vi.fn());
const prisma = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  taskPullRequest: { upsert: vi.fn(), findMany: vi.fn() },
}));

vi.mock("~/lib/db", () => ({ prisma }));
vi.mock("~/lib/github", () => ({
  githubAppClient: () => ({ pulls: { get: pullsGet } }),
  isNotFound: (err: unknown) => (err as { status?: number })?.status === 404,
}));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabledForEveryone: vi.fn() }));
vi.mock("../github-task-sync", () => ({
  normalizeRepo: (s: string) => s.replace(/^https?:\/\/github\.com\//, ""),
}));

import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import {
  attachPullRequest,
  codeTaskDoneBlocker,
  recordPullRequestEvent,
} from "../code-tasks.server";
import { CODE_TASK_DONE_ERROR } from "../code-tasks";

const pr = (state: string, merged = false) => ({
  data: {
    state,
    merged,
    merged_at: merged ? "2026-10-12T00:00:00Z" : null,
    title: "Add login",
    html_url: "https://github.com/dali-lab/os/pull/7",
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isFeatureEnabledForEveryone).mockResolvedValue(true);
  prisma.taskPullRequest.upsert.mockImplementation(async ({ create }: any) => ({ id: "pr1", ...create }));
});

describe("codeTaskDoneBlocker", () => {
  const codeTask = (pullRequests: object[] = [], extra: object = {}) =>
    prisma.task.findUnique.mockResolvedValue({
      isCodeTask: true,
      domain: { code: "Fullstack" },
      pullRequests,
      ...extra,
    });

  it("lets non-code and non-Fullstack tasks through without asking GitHub", async () => {
    prisma.task.findUnique.mockResolvedValue({ isCodeTask: false, domain: { code: "Fullstack" }, pullRequests: [] });
    expect(await codeTaskDoneBlocker("t")).toBeNull();
    codeTask([], { domain: { code: "UIUX" } });
    expect(await codeTaskDoneBlocker("t")).toBeNull();
    expect(pullsGet).not.toHaveBeenCalled();
  });

  it("is off while the flag isn't on for everyone", async () => {
    codeTask();
    vi.mocked(isFeatureEnabledForEveryone).mockResolvedValue(false);
    expect(await codeTaskDoneBlocker("t")).toBeNull();
  });

  it("blocks a code task with no PRs", async () => {
    codeTask();
    expect(await codeTaskDoneBlocker("t")).toBe(CODE_TASK_DONE_ERROR);
  });

  it("passes on a stored merged PR without re-checking", async () => {
    codeTask([{ id: "a", repo: "dali-lab/os", number: 7, state: "merged" }]);
    expect(await codeTaskDoneBlocker("t")).toBeNull();
    expect(pullsGet).not.toHaveBeenCalled();
  });

  it("re-checks unmerged PRs live and passes once GitHub says merged", async () => {
    codeTask([{ id: "a", repo: "dali-lab/os", number: 7, state: "open" }]);
    pullsGet.mockResolvedValue(pr("closed", true));
    expect(await codeTaskDoneBlocker("t")).toBeNull();
    expect(pullsGet).toHaveBeenCalledWith({ owner: "dali-lab", repo: "os", pull_number: 7 });
    expect(prisma.taskPullRequest.upsert.mock.calls[0]![0].update).toMatchObject({ state: "merged" });
  });

  it("still blocks when the PR is open, closed unmerged, gone, or GitHub errors", async () => {
    codeTask([
      { id: "a", repo: "dali-lab/os", number: 7, state: "open" },
      { id: "b", repo: "dali-lab/os", number: 8, state: "open" },
      { id: "c", repo: "dali-lab/os", number: 9, state: "open" },
    ]);
    pullsGet
      .mockResolvedValueOnce(pr("open"))
      .mockRejectedValueOnce({ status: 404 })
      .mockRejectedValueOnce(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await codeTaskDoneBlocker("t")).toBe(CODE_TASK_DONE_ERROR);
    err.mockRestore();
  });
});

describe("attachPullRequest", () => {
  beforeEach(() => {
    prisma.task.findUnique.mockResolvedValue({ project: { repoUrls: ["https://github.com/Dali-Lab/OS"] } });
  });

  it("rejects non-PR links and repos outside the project", async () => {
    expect(await attachPullRequest("t", "https://github.com/dali-lab/os/issues/1")).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await attachPullRequest("t", "https://github.com/other/repo/pull/1")).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(pullsGet).not.toHaveBeenCalled();
  });

  it("attaches with GitHub's current state, using the project's repo spelling", async () => {
    pullsGet.mockResolvedValue(pr("open"));
    const res = await attachPullRequest("t", "https://github.com/dali-lab/os/pull/7");
    expect(res).toMatchObject({ ok: true, pullRequest: { repo: "Dali-Lab/OS", number: 7, state: "open" } });
    expect(pullsGet).toHaveBeenCalledWith({ owner: "Dali-Lab", repo: "OS", pull_number: 7 });
  });

  it("reports a missing PR and a GitHub outage distinctly", async () => {
    pullsGet.mockRejectedValueOnce({ status: 404 });
    expect(await attachPullRequest("t", "https://github.com/dali-lab/os/pull/7")).toMatchObject({ status: 404 });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    pullsGet.mockRejectedValueOnce(new Error("down"));
    expect(await attachPullRequest("t", "https://github.com/dali-lab/os/pull/7")).toMatchObject({ status: 502 });
    err.mockRestore();
  });
});

describe("recordPullRequestEvent", () => {
  const event = (over: object = {}) => ({
    repo: "dali-lab/os",
    number: 7,
    url: "https://github.com/dali-lab/os/pull/7",
    title: "Add login",
    body: "Closes #12",
    state: "merged" as const,
    mergedAt: new Date("2026-10-12T00:00:00Z"),
    refs: { issueNumbers: [12], taskIds: [] as string[] },
    ...over,
  });

  beforeEach(() => {
    prisma.taskPullRequest.findMany.mockResolvedValue([]);
  });

  it("refreshes every task already holding the PR", async () => {
    prisma.taskPullRequest.findMany.mockResolvedValue([{ taskId: "t1", repo: "Dali-Lab/OS" }]);
    await recordPullRequestEvent(event({ state: "closed", mergedAt: null }));
    expect(prisma.taskPullRequest.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.taskPullRequest.upsert.mock.calls[0]![0].where).toEqual({
      taskId_repo_number: { taskId: "t1", repo: "Dali-Lab/OS", number: 7 },
    });
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it("auto-attaches a merged PR to referenced code tasks in projects owning the repo", async () => {
    prisma.task.findMany.mockResolvedValue([
      { id: "mine", project: { repoUrls: ["https://github.com/dali-lab/os"] } },
      { id: "foreign", project: { repoUrls: ["https://github.com/else/where"] } },
    ]);
    const attached = await recordPullRequestEvent(event({ refs: { issueNumbers: [12], taskIds: ["mine"] } }));
    expect(attached).toEqual(["mine"]);
    expect(prisma.task.findMany.mock.calls[0]![0].where).toEqual({
      isCodeTask: true,
      OR: [
        { githubRepo: "dali-lab/os", githubIssueNumber: { in: [12] } },
        { id: { in: ["mine"] } },
      ],
    });
  });

  it("doesn't auto-attach unmerged PRs or PRs with no references", async () => {
    expect(await recordPullRequestEvent(event({ state: "open", mergedAt: null }))).toEqual([]);
    expect(await recordPullRequestEvent(event({ refs: { issueNumbers: [], taskIds: [] } }))).toEqual([]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });
});
