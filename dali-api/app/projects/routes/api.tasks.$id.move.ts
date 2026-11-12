import type { Route } from "./+types/api.tasks.$id.move";
import { prisma } from "~/lib/db.server";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { isTaskStatus } from "../lib/task-board";
import { moveTask, TaskMoveError } from "../lib/task-status.server";

// POST /api/tasks/:id/move
//
// Move a task within the board (drag-and-drop). Body is one of:
//   { status, orderedIds } — orderedIds is the target column's full task id
//     list (including :id) in display order; every listed task's position is
//     renumbered to its index, and :id gets `status`. Handles both cross-
//     column moves and within-column reordering.
//   { status, position }   — legacy append-to-end shape.
//   { status }             — the server appends to the end of that column.
// Same permission model as task creation.

type Body =
  | { status: string; orderedIds: string[]; position?: undefined }
  | { status: string; position?: number; orderedIds?: undefined };

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.status !== "string") return false;
  if (Array.isArray(o.orderedIds)) {
    return o.orderedIds.every((id) => typeof id === "string");
  }
  return o.position === undefined || typeof o.position === "number";
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: { projectId: true },
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

  try {
    await moveTask({
      taskId: params.id!,
      actorId: gate.auth.user.sub,
      status: body.status,
      orderedIds: body.orderedIds,
      position: body.position,
    });
  } catch (err) {
    if (err instanceof TaskMoveError) {
      return withCors(request, Response.json({ error: err.message }, { status: err.status }));
    }
    throw err;
  }

  return withCors(request, Response.json({ ok: true }));
}
