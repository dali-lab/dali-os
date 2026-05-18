import type { Route } from "./+types/api.projects.$id.tasks";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { isTaskStatus } from "../lib/task-board";

// POST /api/projects/:id/tasks
//
// Create a task on a project. Body: { title, status?, sprintId?, epicId? }.
// status defaults to "Todo"; position is appended after the current max in
// the target column so the new card lands last. Mirrors the project-edit
// permission model (isHiringLead === Admin || Core).

type Body = {
  title: string;
  status?: string;
  sprintId?: string | null;
  epicId?: string | null;
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (o.status !== undefined && typeof o.status !== "string") return false;
  if (o.sprintId != null && typeof o.sprintId !== "string") return false;
  if (o.epicId != null && typeof o.epicId !== "string") return false;
  return true;
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await isHiringLead(auth.user.sub))) {
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

  const title = body.title.trim();
  if (!title) {
    return withCors(request, Response.json({ error: "Title is required" }, { status: 400 }));
  }

  const status = body.status ?? "Todo";
  if (!isTaskStatus(status)) {
    return withCors(request, Response.json({ error: "Invalid status" }, { status: 400 }));
  }

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!project) {
    return withCors(request, Response.json({ error: "Project not found" }, { status: 404 }));
  }

  // Append after the current max position in the target column.
  const last = await prisma.task.findFirst({
    where: { projectId: params.id, status },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const task = await prisma.task.create({
    data: {
      projectId: params.id,
      title,
      status,
      position,
      sprintId: body.sprintId ?? null,
      epicId: body.epicId ?? null,
      createdById: auth.user.sub,
    },
    select: { id: true },
  });

  return withCors(request, Response.json({ id: task.id }));
}
