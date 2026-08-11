import { describe, it, expect, beforeEach, vi } from "vitest";

const { issuesGet, createIssueForTask } = vi.hoisted(() => ({
  issuesGet: vi.fn(),
  createIssueForTask: vi.fn(),
}));

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/github", () => ({
  githubAppClient: () => ({ rest: { issues: { get: issuesGet } } }),
  parseRepo: (value: string) => {
    const [owner, repo] = value.split("/");
    return { owner, repo };
  },
  isNotFound: (err: unknown) => (err as { status?: number } | null)?.status === 404,
}));
// Keep the real normalizeRepo (pure); stub createIssueForTask so the create
// path doesn't reach the GitHub API.
vi.mock("~/projects/lib/github-task-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/projects/lib/github-task-sync")>();
  return { ...actual, createIssueForTask };
});

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { action } from "~/projects/routes/api.tasks.$id.github";

const TASK_ID = "task-1";
const PROJECT_ID = "proj-1";

const mockPrisma = prisma as unknown as {
  task: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function mockTask(overrides: Record<string, unknown> = {}) {
  mockPrisma.task.findUnique.mockResolvedValue({
    id: TASK_ID,
    projectId: PROJECT_ID,
    githubIssueNumber: null,
    project: { repoUrls: ["https://github.com/dali/app.git"] },
    ...overrides,
  });
}

function post(body: unknown) {
  const request = new Request(`http://localhost/api/tasks/${TASK_ID}/github`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return action({ request, params: { id: TASK_ID } } as any);
}

function del() {
  const request = new Request(`http://localhost/api/tasks/${TASK_ID}/github`, {
    method: "DELETE",
  });
  return action({ request, params: { id: TASK_ID } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProjectEditAccess).mockResolvedValue({
    ok: true,
    auth: { user: { sub: "user-1" } },
  } as any);
  mockPrisma.task = {
    findUnique: vi.fn(),
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  };
  mockTask();
  issuesGet.mockResolvedValue({
    data: { html_url: "https://github.com/dali/app/issues/42" },
  });
});

describe("POST /api/tasks/:id/github", () => {
  it("rejects a repo that is not one of the project's repoUrls", async () => {
    const res = await post({ repo: "dali/other", issueNumber: 42 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("repoUrls"),
    });
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("rejects when the task is already linked", async () => {
    mockTask({ githubIssueNumber: 7 });
    const res = await post({ repo: "dali/app", issueNumber: 42 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("already linked"),
    });
  });

  it("rejects a non-integer issue number", async () => {
    const res = await post({ repo: "dali/app", issueNumber: 4.5 });
    expect(res.status).toBe(400);
  });

  it("409s when another task already mirrors that issue", async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ id: "task-2" });
    const res = await post({ repo: "dali/app", issueNumber: 42 });
    expect(res.status).toBe(409);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("rejects when the issue does not exist on GitHub", async () => {
    issuesGet.mockRejectedValue({ status: 404 });
    const res = await post({ repo: "dali/app", issueNumber: 999 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("not found"),
    });
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("502s when the GitHub lookup fails for another reason", async () => {
    issuesGet.mockRejectedValue(new Error("rate limited"));
    const res = await post({ repo: "dali/app", issueNumber: 42 });
    expect(res.status).toBe(502);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("links an existing issue, accepting the repo in URL form", async () => {
    // The project stores a full .git URL; the client sends "owner/repo" —
    // both normalize to the same repo.
    const res = await post({ repo: "https://github.com/dali/app", issueNumber: 42 });
    expect(res.status).toBe(200);
    expect(issuesGet).toHaveBeenCalledWith({
      owner: "dali",
      repo: "app",
      issue_number: 42,
    });
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: {
        githubRepo: "dali/app",
        githubIssueNumber: 42,
        githubIssueUrl: "https://github.com/dali/app/issues/42",
        activityAt: expect.any(Date),
      },
    });
    expect(await res.json()).toEqual({
      ok: true,
      githubRepo: "dali/app",
      githubIssueNumber: 42,
      githubIssueUrl: "https://github.com/dali/app/issues/42",
    });
  });
});

describe("POST /api/tasks/:id/github (create mode)", () => {
  it("creates a new issue when no issueNumber is given", async () => {
    createIssueForTask.mockResolvedValue({
      githubRepo: "dali/app",
      githubIssueNumber: 15,
      githubIssueUrl: "https://github.com/dali/app/issues/15",
    });
    const res = await post({ repo: "dali/app" });
    expect(res.status).toBe(200);
    expect(createIssueForTask).toHaveBeenCalledWith(TASK_ID, "dali/app");
    // Create mode never verifies an existing issue.
    expect(issuesGet).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      ok: true,
      githubRepo: "dali/app",
      githubIssueNumber: 15,
      githubIssueUrl: "https://github.com/dali/app/issues/15",
    });
  });

  it("502s when issue creation fails", async () => {
    createIssueForTask.mockResolvedValue(null);
    const res = await post({ repo: "dali/app" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("create"),
    });
  });

  it("rejects a repo not in the project's repoUrls before creating", async () => {
    const res = await post({ repo: "dali/other" });
    expect(res.status).toBe(400);
    expect(createIssueForTask).not.toHaveBeenCalled();
  });

  it("rejects create when the task is already linked", async () => {
    mockTask({ githubIssueNumber: 7 });
    const res = await post({ repo: "dali/app" });
    expect(res.status).toBe(400);
    expect(createIssueForTask).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/tasks/:id/github", () => {
  it("clears the mirror fields when linked", async () => {
    mockTask({ githubIssueNumber: 42 });
    const res = await del();
    expect(res.status).toBe(200);
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: {
        githubRepo: null,
        githubIssueNumber: null,
        githubIssueUrl: null,
        activityAt: expect.any(Date),
      },
    });
  });

  it("no-ops when the task is not linked", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, noop: true });
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });
});
