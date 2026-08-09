import type { Route } from "./+types/api.tasks.$id.comments";
import { prisma } from "~/lib/db";
import { requireMemberSession } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { resolvePhotoUrl } from "~/lib/photo";
import { notifyTaskComment } from "../lib/task-notifications.server";

// GET  /api/tasks/:id/comments — list a task's comments, oldest first.
//      Readable by any DALI member (project boards are member-visible).
// POST /api/tasks/:id/comments — append one. Body: { body }. Permission
//      mirrors MCP add_task_comment: the task's assignees and Core.
//      Assignees are notified via the task.comment event (author excluded).

const BODY_MAX = 10_000;

async function commentShape(row: {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; firstName: string; lastName: string; photoUrl: string | null };
}) {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: {
      id: row.author.id,
      name: `${row.author.firstName} ${row.author.lastName}`.trim(),
      photoUrl: await resolvePhotoUrl(row.author.photoUrl),
    },
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }

  const rows = await prisma.taskComment.findMany({
    where: { taskId: params.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
    },
  });
  return withCors(request, Response.json({ comments: await Promise.all(rows.map(commentShape)) }));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;
  const userId = gate.auth.user.sub;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  const raw =
    body && typeof body === "object" && typeof (body as { body?: unknown }).body === "string"
      ? (body as { body: string }).body
      : "";
  const text = raw.trim();
  if (!text) {
    return withCors(request, Response.json({ error: "Body is required" }, { status: 400 }));
  }
  if (text.length > BODY_MAX) {
    return withCors(request, Response.json({ error: "Comment is too long" }, { status: 400 }));
  }

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: { id: true, assignees: { select: { userId: true } } },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }

  const isAssignee = task.assignees.some((a) => a.userId === userId);
  if (!isAssignee && !(await isCore(userId))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const [comment] = await prisma.$transaction([
    prisma.taskComment.create({
      data: { taskId: params.id, authorId: userId, body: text },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
      },
    }),
    // A comment doesn't touch any other Task field, so it needs its own bump
    // — see Task.activityAt.
    prisma.task.update({ where: { id: params.id }, data: { activityAt: new Date() } }),
  ]);

  void notifyTaskComment({ taskId: params.id, authorId: userId, body: text }).catch(
    (err) => console.error(`task ${params.id}: comment notify failed`, err),
  );

  return withCors(request, Response.json(await commentShape(comment)));
}
