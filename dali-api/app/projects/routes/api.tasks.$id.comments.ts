import type { Route } from "./+types/api.tasks.$id.comments";
import { prisma } from "~/lib/db";
import { requireMemberSession, requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { resolvePhotoUrl } from "~/lib/photo";
import { notifyTaskComment } from "../lib/task-notifications.server";

// GET  /api/tasks/:id/comments — list a task's comments, oldest first.
//      Readable by any DALI member (project boards are member-visible).
// POST /api/tasks/:id/comments — append one. Body: { body }. Permission is
//      project edit access — Core, or anyone staffed on the task's project —
//      the same gate every other task route uses (edit, move, files, github,
//      view). It used to be "the task's assignees and Core", copied from the
//      MCP add_task_comment tool, which left a project member able to rename,
//      move and re-status a task from the board but not comment on it: the
//      modal answered "Forbidden" every time they tried.
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
  // The project is the permission subject, so the task is read before the
  // gate — hence the 404 for a missing task ahead of the 403 for one you
  // can't write to. A task id is not a secret (it comes off a board you can
  // already see), so the order leaks nothing.
  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: { id: true, projectId: true },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }

  const gate = await requireProjectEditAccess(request, task.projectId);
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
