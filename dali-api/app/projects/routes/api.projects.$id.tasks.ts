import type { Route } from "./+types/api.projects.$id.tasks";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { isTaskStatus } from "../lib/task-board";
import { createIssueForTask, normalizeRepo } from "../lib/github-task-sync";
import { USER_NAME_SELECT } from "~/lib/prisma-shapes";
import { fullName } from "~/lib/display";
import { activeSprintId, resolveTaskPlacement } from "../lib/sprints.server";

// POST /api/projects/:id/tasks — create a task. No epic files it under the
// project's General epic; no sprint puts it in the backlog; sprintId
// "current" means the active sprint.

type Body = {
  title: string;
  description?: string | null;
  status?: string;
  epicId?: string | null;
  sprintId?: string | null;
  // `repo` must be one of the project's repoUrls (validated server-side).
  github?: { repo: string };
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (o.description != null && typeof o.description !== "string") return false;
  if (o.status !== undefined && typeof o.status !== "string") return false;
  if (o.epicId != null && typeof o.epicId !== "string") return false;
  if (o.sprintId != null && typeof o.sprintId !== "string") return false;
  if (o.github !== undefined) {
    if (!o.github || typeof o.github !== "object") return false;
    const g = o.github as Record<string, unknown>;
    if (typeof g.repo !== "string") return false;
  }
  return true;
}

// GET /api/projects/:id/tasks — list a project's archived tasks
// (board Archive + weekly auto-archive of Done/Cancelled), newest-archived
// first. Backs the board's "Archived" modal, so it stays a lazy fetch rather
// than bloating the project loader (which only ever loads the live,
// non-archived board).
export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const gate = await requireProjectEditAccess(request, params.id!);
  if (!gate.ok) return gate.response;

  const rows = await prisma.task.findMany({
    where: { projectId: params.id, archivedAt: { not: null } },
    orderBy: { archivedAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      archivedAt: true,
      sprint: { select: { number: true } },
      domain: { select: { id: true, displayName: true } },
      assignees: { select: { user: { select: USER_NAME_SELECT } } },
    },
  });

  const tasks = rows.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    sprint: t.sprint ? `Sprint ${t.sprint.number}` : null,
    archivedAt: t.archivedAt!.toISOString(),
    domain: t.domain ? { id: t.domain.id, name: t.domain.displayName } : null,
    assignees: t.assignees.map((a) => ({ id: a.user.id, name: fullName(a.user) })),
  }));

  return withCors(request, Response.json({ tasks }));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireProjectEditAccess(request, params.id!);
  if (!gate.ok) return gate.response;
  const auth = gate.auth;

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
  if (!isTaskStatus(status) || status === "Backlog") {
    return withCors(request, Response.json({ error: "Invalid status" }, { status: 400 }));
  }

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true, repoUrls: true },
  });
  if (!project) {
    return withCors(request, Response.json({ error: "Project not found" }, { status: 404 }));
  }

  let sprintId = body.sprintId ?? null;
  if (sprintId === "current") {
    sprintId = await activeSprintId(params.id!);
    if (!sprintId) {
      return withCors(
        request,
        Response.json({ error: "No sprint is running on this project" }, { status: 400 }),
      );
    }
  }
  const placed = await resolveTaskPlacement(params.id, { epicId: body.epicId, sprintId });
  if ("error" in placed) {
    return withCors(request, Response.json(placed, { status: 400 }));
  }

  // Validate the GH repo (if requested) is one of the project's declared
  // repos. Compare in normalized "owner/repo" form so users can paste either
  // the URL or the shortform when configuring the project.
  let githubRepo: string | null = null;
  if (body.github) {
    const requested = normalizeRepo(body.github.repo);
    if (!requested) {
      return withCors(request, Response.json({ error: "Invalid github.repo" }, { status: 400 }));
    }
    const allowed = project.repoUrls.map(normalizeRepo).filter((r): r is string => !!r);
    if (!allowed.includes(requested)) {
      return withCors(
        request,
        Response.json({ error: "github.repo is not in project.repoUrls" }, { status: 400 }),
      );
    }
    githubRepo = requested;
  }

  const last = await prisma.task.findFirst({
    where: { projectId: params.id, status, sprintId: placed.sprintId ?? null },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const description = body.description?.trim() || null;

  const task = await prisma.task.create({
    data: {
      projectId: params.id,
      title,
      description,
      status,
      position,
      epicId: placed.epicId,
      sprintId: placed.sprintId ?? null,
      createdById: auth.user.sub,
    },
    select: { id: true },
  });

  if (githubRepo) {
    // Fire-and-forget: GH outage or slow response must never block the user.
    void createIssueForTask(task.id, githubRepo).catch((err) =>
      console.error(`task ${task.id}: github mirror failed`, err),
    );
  }

  return withCors(request, Response.json({ id: task.id }));
}
