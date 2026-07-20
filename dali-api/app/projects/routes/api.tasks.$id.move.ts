import type { Route } from "./+types/api.tasks.$id.move";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { isTaskStatus } from "../lib/task-board";
import { closeIssueForTask, syncIssueForTask } from "../lib/github-task-sync";
import { notifyTaskStatusChanged } from "../lib/task-notifications.server";

// POST /api/tasks/:id/move
//
// Move a task within the board (drag-and-drop). Body is one of:
//   { status, orderedIds } — orderedIds is the target column's full task id
//     list (including :id) in display order; every listed task's position is
//     renumbered to its index, and :id gets `status`. Handles both cross-
//     column moves and within-column reordering.
//   { status, position }   — legacy append-to-end shape.
// Same permission model as task creation.

type Body =
  | { status: string; orderedIds: string[]; position?: undefined }
  | { status: string; position: number; orderedIds?: undefined };

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.status !== "string") return false;
  if (Array.isArray(o.orderedIds)) {
    return o.orderedIds.every((id) => typeof id === "string");
  }
  return typeof o.position === "number";
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: { id: true, githubIssueNumber: true, projectId: true, status: true },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, task.projectId);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }
  if (!isTaskStatus(body.status)) {
    return withCors(request, Response.json({ error: "Invalid status" }, { status: 400 }));
  }

  if (body.orderedIds !== undefined) {
    if (!body.orderedIds.includes(params.id!)) {
      return withCors(
        request,
        Response.json({ error: "orderedIds must include the moved task" }, { status: 400 }),
      );
    }
    // Every listed task must belong to the same project — a foreign id would
    // let a member of one project renumber another project's board.
    const listed = await prisma.task.findMany({
      where: { id: { in: body.orderedIds } },
      select: { id: true, projectId: true },
    });
    if (
      listed.length !== body.orderedIds.length ||
      listed.some((t) => t.projectId !== task.projectId)
    ) {
      return withCors(
        request,
        Response.json({ error: "orderedIds must be tasks of this project" }, { status: 400 }),
      );
    }
    const status = body.status;
    await prisma.$transaction(
      body.orderedIds.map((id, index) =>
        prisma.task.update({
          where: { id },
          data: id === params.id ? { status, position: index } : { position: index },
        }),
      ),
    );
  } else {
    await prisma.task.update({
      where: { id: params.id },
      data: { status: body.status, position: body.position },
    });
  }

  // Assignees (minus the actor) hear about status changes — the in-app
  // counterpart of the task.github_update notification. Fire-and-forget.
  if (body.status !== task.status) {
    void notifyTaskStatusChanged(params.id!, gate.auth.user.sub, body.status).catch(
      (err) => console.error(`task ${params.id}: status notify failed`, err),
    );
  }

  // Mirror to GitHub: Done/Cancelled close the issue, anything else relabels
  // (and reopens if it was previously closed). Fire-and-forget.
  if (task.githubIssueNumber !== null) {
    if (body.status === "Done") {
      void closeIssueForTask(params.id, "completed").catch((err) =>
        console.error(`task ${params.id}: github close failed`, err),
      );
    } else if (body.status === "Cancelled") {
      void closeIssueForTask(params.id, "not_planned").catch((err) =>
        console.error(`task ${params.id}: github close failed`, err),
      );
    } else {
      void syncIssueForTask(params.id).catch((err) =>
        console.error(`task ${params.id}: github sync failed`, err),
      );
    }
  }

  return withCors(request, Response.json({ ok: true }));
}
