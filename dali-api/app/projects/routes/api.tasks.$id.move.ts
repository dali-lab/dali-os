import type { Route } from "./+types/api.tasks.$id.move";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { isTaskStatus } from "../lib/task-board";
import { closeIssueForTask, syncIssueForTask } from "../lib/github-task-sync";

// POST /api/tasks/:id/move
//
// Move a task to a different status column (drag-and-drop). Body:
// { status, position }. Position is the column-local ordering key the client
// computed (append-to-end in v1). Same permission model as task creation.

type Body = {
  status: string;
  position: number;
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.status === "string" && typeof o.position === "number";
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await isCore(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

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

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: { id: true, githubIssueNumber: true },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }

  await prisma.task.update({
    where: { id: params.id },
    data: { status: body.status, position: body.position },
  });

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
