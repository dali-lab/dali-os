import type { Route } from "./+types/api.tasks.$id.pull-requests";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { attachPullRequest } from "../lib/code-tasks.server";

// POST   /api/tasks/:id/pull-requests { url } — attach a GitHub PR (checked
//        against GitHub; must be in one of the project's repos).
// DELETE /api/tasks/:id/pull-requests { pullRequestId } — detach one.
export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST" && request.method !== "DELETE") {
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

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  if (request.method === "DELETE") {
    if (typeof body?.pullRequestId !== "string") {
      return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
    }
    await prisma.taskPullRequest.deleteMany({ where: { id: body.pullRequestId, taskId: task.id } });
    return withCors(request, Response.json({ ok: true }));
  }

  if (typeof body?.url !== "string") {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }
  const res = await attachPullRequest(task.id, body.url);
  if (!res.ok) {
    return withCors(request, Response.json({ error: res.error }, { status: res.status }));
  }
  return withCors(request, Response.json({ pullRequest: res.pullRequest }));
}
