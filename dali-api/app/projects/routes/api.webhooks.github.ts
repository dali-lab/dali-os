import type { Route } from "./+types/api.webhooks.github";
import { prisma } from "~/lib/db";
import { verifyGithubSignature } from "~/lib/github-webhook";
import { wasRecentOutbound } from "../lib/github-task-sync";
import {
  notifyTaskAssigned,
  notifyTaskComment,
  notifyTaskGithubUpdate,
} from "../lib/task-notifications.server";
import type { TaskStatus } from "../lib/task-board";

// GitHub webhook receiver for issue events on repos linked to dalios tasks.
// Mirrors the Slack handler's shape: verify signature, ack within 3s, do
// real work async. Configured in the GH App settings; the App must subscribe
// to `Issues` and `Issue comment`.

export async function action({ request }: Route.ActionArgs) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "GitHub webhook disabled" }, { status: 503 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const rawBody = await request.text();
  const verification = verifyGithubSignature({
    secret,
    signature: request.headers.get("x-hub-signature-256"),
    rawBody,
  });
  if (!verification.ok) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (event === "ping") {
    return Response.json({ pong: true });
  }

  // Ack synchronously; dispatch async. GH retries on non-2xx, so we never
  // want to surface a handler error back here — the dispatcher logs.
  dispatch(event, payload);
  return Response.json({ ok: true });
}

function dispatch(event: string | null, payload: unknown): void {
  if (!event || !isObject(payload)) return;
  switch (event) {
    case "issues":
      void handleIssues(payload).catch((err) =>
        console.error("github webhook: handleIssues failed", err),
      );
      break;
    case "issue_comment":
      void handleIssueComment(payload).catch((err) =>
        console.error("github webhook: handleIssueComment failed", err),
      );
      break;
    default:
      // Unsubscribed event — ignore.
      break;
  }
}

// ─── issues handler ─────────────────────────────────────────────────────────

async function handleIssues(payload: Record<string, unknown>): Promise<void> {
  const action = stringField(payload, "action");
  const issue = recordField(payload, "issue");
  const repo = repoFullName(payload);
  if (!action || !issue || !repo) return;
  const number = numberField(issue, "number");
  if (number === null) return;

  // Drop events we just caused (we already updated dalios state directly).
  if (wasRecentOutbound(repo, number)) return;

  const task = await prisma.task.findUnique({
    where: {
      task_github_issue_unique: { githubRepo: repo, githubIssueNumber: number },
    },
    select: { id: true, status: true, projectId: true },
  });
  if (!task) return;

  switch (action) {
    case "closed": {
      const stateReason = stringField(issue, "state_reason");
      const newStatus: TaskStatus = stateReason === "not_planned" ? "Cancelled" : "Done";
      if (task.status !== "Done" && task.status !== "Cancelled") {
        await prisma.task.update({
          where: { id: task.id },
          data: { status: newStatus, activityAt: new Date() },
        });
        await notifyTaskGithubUpdate({
          taskId: task.id,
          action: "closed",
          newStatus: newStatus === "Cancelled" ? "Cancelled" : "Done",
        });
      }
      break;
    }
    case "reopened": {
      if (task.status === "Done" || task.status === "Cancelled") {
        await prisma.task.update({
          where: { id: task.id },
          data: { status: "InProgress", activityAt: new Date() },
        });
        await notifyTaskGithubUpdate({
          taskId: task.id,
          action: "reopened",
          newStatus: "In progress",
        });
      }
      break;
    }
    case "assigned":
    case "unassigned": {
      const assignee = recordField(payload, "assignee");
      const login = assignee ? stringField(assignee, "login") : null;
      if (!login) return;
      const user = await prisma.user.findFirst({
        where: { githubUsername: login },
        select: { id: true },
      });
      if (!user) return;
      if (action === "assigned") {
        const created = await prisma.taskAssignee
          .create({ data: { taskId: task.id, userId: user.id } })
          .then(() => true)
          .catch(() => false); // already assigned = unique violation, fine
        if (created) {
          await notifyTaskAssigned({ taskId: task.id, addedUserIds: [user.id] });
        }
      } else {
        await prisma.taskAssignee.deleteMany({
          where: { taskId: task.id, userId: user.id },
        });
      }
      break;
    }
    default:
      break;
  }
}

// ─── issue_comment handler ──────────────────────────────────────────────────

async function handleIssueComment(payload: Record<string, unknown>): Promise<void> {
  if (stringField(payload, "action") !== "created") return;
  const issue = recordField(payload, "issue");
  const comment = recordField(payload, "comment");
  const repo = repoFullName(payload);
  if (!issue || !comment || !repo) return;

  const number = numberField(issue, "number");
  const body = stringField(comment, "body");
  if (number === null || !body) return;

  if (wasRecentOutbound(repo, number)) return;
  // Don't mirror our own dalios-origin comments back as TaskComments.
  if (body.includes("<!-- dalios:")) return;

  const task = await prisma.task.findUnique({
    where: {
      task_github_issue_unique: { githubRepo: repo, githubIssueNumber: number },
    },
    select: { id: true, createdById: true },
  });
  if (!task) return;

  const author = recordField(comment, "user");
  const login = author ? stringField(author, "login") : null;
  let authorId = task.createdById;
  let prefixed = body;
  if (login) {
    const user = await prisma.user.findFirst({
      where: { githubUsername: login },
      select: { id: true },
    });
    if (user) {
      authorId = user.id;
    } else {
      prefixed = `**[GitHub: ${login}]** ${body}`;
    }
  }

  await prisma.taskComment.create({
    data: { taskId: task.id, authorId, body: prefixed },
  });
  await notifyTaskComment({ taskId: task.id, authorId, body: prefixed });
}

// ─── helpers ────────────────────────────────────────────────────────────────

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function numberField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" ? v : null;
}

function recordField(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = obj[key];
  return isObject(v) ? v : null;
}

function repoFullName(payload: Record<string, unknown>): string | null {
  const r = recordField(payload, "repository");
  return r ? stringField(r, "full_name") : null;
}
