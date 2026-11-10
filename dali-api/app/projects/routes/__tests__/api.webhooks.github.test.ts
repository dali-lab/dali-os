import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    task: { findUnique: vi.fn(), update: vi.fn() },
    user: { findFirst: vi.fn() },
    taskAssignee: { create: vi.fn(), deleteMany: vi.fn() },
    taskComment: { create: vi.fn() },
  },
}));
vi.mock("~/projects/lib/github-task-sync", () => ({ wasRecentOutbound: vi.fn() }));
vi.mock("~/projects/lib/task-notifications.server", () => ({
  notifyTaskAssigned: vi.fn(),
  notifyTaskComment: vi.fn(),
  notifyTaskGithubUpdate: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { wasRecentOutbound } from "~/projects/lib/github-task-sync";
import {
  notifyTaskAssigned,
  notifyTaskComment,
  notifyTaskGithubUpdate,
} from "~/projects/lib/task-notifications.server";
import { action } from "~/projects/routes/api.webhooks.github";

const SECRET = "test-webhook-secret";
const db = prisma as any;
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function sign(body: string, secret = SECRET) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function send(
  payload: unknown,
  opts: { event?: string | null; signature?: string | null; method?: string; raw?: string } = {},
) {
  const body = opts.raw ?? JSON.stringify(payload);
  const headers: Record<string, string> = {};
  const signature = opts.signature === undefined ? sign(body) : opts.signature;
  if (signature) headers["x-hub-signature-256"] = signature;
  if (opts.event !== null) headers["x-github-event"] = opts.event ?? "issues";
  const request = new Request("http://x/api/webhooks/github", {
    method: opts.method ?? "POST",
    headers,
    body: opts.method === "GET" ? undefined : body,
  });
  const res = (await action({ request } as Parameters<typeof action>[0])) as Response;
  // dispatch() is fire-and-forget; let the handler promise chain settle.
  await new Promise((r) => setTimeout(r, 0));
  return res;
}

const issuePayload = (action: string, extra: Record<string, unknown> = {}, issue: Record<string, unknown> = {}) => ({
  action,
  repository: { full_name: "dali/repo" },
  issue: { number: 7, ...issue },
  ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  m(wasRecentOutbound).mockReturnValue(false);
  m(db.task.findUnique).mockResolvedValue({ id: "t1", status: "InProgress", projectId: "p1", createdById: "creator" });
  m(db.user.findFirst).mockResolvedValue({ id: "u-ada" });
  m(db.taskAssignee.create).mockResolvedValue({});
});

afterEach(() => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
});

describe("github webhook gate", () => {
  it("503s when no secret is configured", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const res = await send(issuePayload("closed"));
    expect(res.status).toBe(503);
    expect(db.task.findUnique).not.toHaveBeenCalled();
  });

  it("405s on non-POST", async () => {
    const res = await send({}, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("401s on a missing signature and does no work", async () => {
    const res = await send(issuePayload("closed"), { signature: null });
    expect(res.status).toBe(401);
    expect(db.task.findUnique).not.toHaveBeenCalled();
  });

  it("401s on a signature made with the wrong secret", async () => {
    const body = JSON.stringify(issuePayload("closed"));
    const res = await send(null, { raw: body, signature: sign(body, "other") });
    expect(res.status).toBe(401);
    expect(db.task.findUnique).not.toHaveBeenCalled();
  });

  it("401s when the body was altered after signing", async () => {
    const signature = sign(JSON.stringify(issuePayload("closed")));
    const res = await send(null, { raw: JSON.stringify(issuePayload("reopened")), signature });
    expect(res.status).toBe(401);
  });

  it("400s on a correctly signed body that is not JSON", async () => {
    const res = await send(null, { raw: "not json" });
    expect(res.status).toBe(400);
  });

  it("answers ping with pong and no work", async () => {
    const res = await send({ zen: "hi" }, { event: "ping" });
    expect(await res.json()).toEqual({ pong: true });
    expect(db.task.findUnique).not.toHaveBeenCalled();
  });

  it("acks unsubscribed events and missing event headers without work", async () => {
    expect((await send(issuePayload("closed"), { event: "push" })).status).toBe(200);
    expect((await send(issuePayload("closed"), { event: null })).status).toBe(200);
    expect(db.task.findUnique).not.toHaveBeenCalled();
  });

  it("acks 200 even when the handler throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m(db.task.findUnique).mockRejectedValue(new Error("db down"));
    const res = await send(issuePayload("closed"));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("ignores non-object payloads", async () => {
    const res = await send([1, 2]);
    expect(res.status).toBe(200);
    expect(db.task.findUnique).not.toHaveBeenCalled();
  });
});

describe("issues events", () => {
  it("looks tasks up by repo and issue number", async () => {
    await send(issuePayload("closed"));
    expect(db.task.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { task_github_issue_unique: { githubRepo: "dali/repo", githubIssueNumber: 7 } },
      }),
    );
  });

  it("drops events echoing our own recent outbound write", async () => {
    m(wasRecentOutbound).mockReturnValue(true);
    await send(issuePayload("closed"));
    expect(wasRecentOutbound).toHaveBeenCalledWith("dali/repo", 7);
    expect(db.task.findUnique).not.toHaveBeenCalled();
  });

  it("does nothing when the issue is not linked to a task", async () => {
    m(db.task.findUnique).mockResolvedValue(null);
    await send(issuePayload("closed"));
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it.each([
    ["missing repository", { repository: undefined }],
    ["missing issue", { issue: undefined }],
  ])("ignores payloads with %s", async (_n, patch) => {
    await send({ ...issuePayload("closed"), ...patch });
    expect(db.task.findUnique).not.toHaveBeenCalled();
  });

  it("ignores issues without a numeric number", async () => {
    await send(issuePayload("closed", {}, { number: "7" }));
    expect(db.task.findUnique).not.toHaveBeenCalled();
  });

  it("closing marks an open task Done and notifies", async () => {
    await send(issuePayload("closed"));
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "Done", activityAt: expect.any(Date) },
    });
    expect(notifyTaskGithubUpdate).toHaveBeenCalledWith({ taskId: "t1", action: "closed", newStatus: "Done" });
  });

  it("closing as not_planned cancels the task", async () => {
    await send(issuePayload("closed", {}, { state_reason: "not_planned" }));
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "Cancelled", activityAt: expect.any(Date) },
    });
    expect(notifyTaskGithubUpdate).toHaveBeenCalledWith({ taskId: "t1", action: "closed", newStatus: "Cancelled" });
  });

  it.each(["Done", "Cancelled"])("closing a %s task is a no-op", async (status) => {
    m(db.task.findUnique).mockResolvedValue({ id: "t1", status, projectId: "p1" });
    await send(issuePayload("closed"));
    expect(db.task.update).not.toHaveBeenCalled();
    expect(notifyTaskGithubUpdate).not.toHaveBeenCalled();
  });

  it.each(["Done", "Cancelled"])("reopening a %s task moves it to InProgress", async (status) => {
    m(db.task.findUnique).mockResolvedValue({ id: "t1", status, projectId: "p1" });
    await send(issuePayload("reopened"));
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "InProgress", activityAt: expect.any(Date) },
    });
    expect(notifyTaskGithubUpdate).toHaveBeenCalledWith({
      taskId: "t1",
      action: "reopened",
      newStatus: "In progress",
    });
  });

  it("reopening a task that is still open changes nothing", async () => {
    await send(issuePayload("reopened"));
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("assigning adds the matching user and notifies", async () => {
    await send(issuePayload("assigned", { assignee: { login: "ada-gh" } }));
    expect(db.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { githubUsername: "ada-gh" } }));
    expect(db.taskAssignee.create).toHaveBeenCalledWith({ data: { taskId: "t1", userId: "u-ada" } });
    expect(notifyTaskAssigned).toHaveBeenCalledWith({ taskId: "t1", addedUserIds: ["u-ada"] });
  });

  it("assigning an already-assigned user does not notify again", async () => {
    m(db.taskAssignee.create).mockRejectedValue(new Error("unique"));
    await send(issuePayload("assigned", { assignee: { login: "ada-gh" } }));
    expect(notifyTaskAssigned).not.toHaveBeenCalled();
  });

  it("unassigning removes the matching user", async () => {
    await send(issuePayload("unassigned", { assignee: { login: "ada-gh" } }));
    expect(db.taskAssignee.deleteMany).toHaveBeenCalledWith({ where: { taskId: "t1", userId: "u-ada" } });
    expect(notifyTaskAssigned).not.toHaveBeenCalled();
  });

  it("ignores assignment for unknown GitHub logins or a missing assignee", async () => {
    m(db.user.findFirst).mockResolvedValue(null);
    await send(issuePayload("assigned", { assignee: { login: "stranger" } }));
    await send(issuePayload("assigned"));
    expect(db.taskAssignee.create).not.toHaveBeenCalled();
    expect(db.taskAssignee.deleteMany).not.toHaveBeenCalled();
  });

  it("ignores other issue actions", async () => {
    await send(issuePayload("labeled"));
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.taskAssignee.create).not.toHaveBeenCalled();
  });
});

describe("issue_comment events", () => {
  const comment = (body: string, login?: string, action = "created") => ({
    action,
    repository: { full_name: "dali/repo" },
    issue: { number: 7 },
    comment: { body, ...(login ? { user: { login } } : {}) },
  });

  it("mirrors a comment from a linked GitHub user under their DALI account", async () => {
    await send(comment("looks good", "ada-gh"), { event: "issue_comment" });
    expect(db.taskComment.create).toHaveBeenCalledWith({
      data: { taskId: "t1", authorId: "u-ada", body: "looks good" },
    });
    expect(notifyTaskComment).toHaveBeenCalledWith({ taskId: "t1", authorId: "u-ada", body: "looks good" });
  });

  it("attributes unknown GitHub users to the task creator with a prefix", async () => {
    m(db.user.findFirst).mockResolvedValue(null);
    await send(comment("hi", "stranger"), { event: "issue_comment" });
    expect(db.taskComment.create).toHaveBeenCalledWith({
      data: { taskId: "t1", authorId: "creator", body: "**[GitHub: stranger]** hi" },
    });
  });

  it("falls back to the task creator when the comment has no user", async () => {
    await send(comment("hi"), { event: "issue_comment" });
    expect(db.taskComment.create).toHaveBeenCalledWith({
      data: { taskId: "t1", authorId: "creator", body: "hi" },
    });
  });

  it("does not mirror edited or deleted comments", async () => {
    await send(comment("x", "ada-gh", "edited"), { event: "issue_comment" });
    await send(comment("x", "ada-gh", "deleted"), { event: "issue_comment" });
    expect(db.taskComment.create).not.toHaveBeenCalled();
  });

  it("does not echo dalios-origin comments or recent outbound writes", async () => {
    await send(comment("synced <!-- dalios:abc -->", "ada-gh"), { event: "issue_comment" });
    expect(db.taskComment.create).not.toHaveBeenCalled();
    m(wasRecentOutbound).mockReturnValue(true);
    await send(comment("plain", "ada-gh"), { event: "issue_comment" });
    expect(db.taskComment.create).not.toHaveBeenCalled();
  });

  it("skips empty bodies and unlinked issues", async () => {
    await send(comment("", "ada-gh"), { event: "issue_comment" });
    expect(db.task.findUnique).not.toHaveBeenCalled();
    m(db.task.findUnique).mockResolvedValue(null);
    await send(comment("hi", "ada-gh"), { event: "issue_comment" });
    expect(db.taskComment.create).not.toHaveBeenCalled();
  });
});
