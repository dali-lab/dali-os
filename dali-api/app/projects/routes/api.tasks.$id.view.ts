import type { Route } from "./+types/api.tasks.$id.view";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

// POST /api/tasks/:id/view — stamp "the viewer opened this task just now".
// Compared against Task.activityAt to clear the board's "new updates" dot
// for this viewer; other viewers' dots are untouched. No body.

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: { id: true, projectId: true },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, task.projectId);
  if (!gate.ok) return gate.response;

  const viewedAt = new Date();
  await prisma.taskView.upsert({
    where: { taskId_userId: { taskId: params.id!, userId: gate.auth.user.sub } },
    create: { taskId: params.id!, userId: gate.auth.user.sub, viewedAt },
    update: { viewedAt },
  });

  return withCors(request, Response.json({ ok: true, viewedAt: viewedAt.toISOString() }));
}
