import type { Route } from "./+types/api.projects.$id.tasks";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { isTaskStatus } from "../lib/task-board";
import { createIssueForTask, normalizeRepo } from "../lib/github-task-sync";

// POST /api/projects/:id/tasks
//
// Create a task on a project. Body: { title, status?, sprintId?, epicId? }.
// status defaults to "Todo"; position is appended after the current max in
// the target column so the new card lands last. Mirrors the project-edit
// permission model (isCore === Admin || Core).

type Body = {
  title: string;
  status?: string;
  sprintId?: string | null;
  epicId?: string | null;
  // ISO timestamp (or null/absent for no deadline).
  dueAt?: string | null;
  // Present = mirror to GH. `repo` must be one of the project's repoUrls
  // (server validates; never trust the client's free-text).
  github?: { repo: string };
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (o.status !== undefined && typeof o.status !== "string") return false;
  if (o.sprintId != null && typeof o.sprintId !== "string") return false;
  if (o.epicId != null && typeof o.epicId !== "string") return false;
  if (o.dueAt != null && typeof o.dueAt !== "string") return false;
  if (o.github !== undefined) {
    if (!o.github || typeof o.github !== "object") return false;
    const g = o.github as Record<string, unknown>;
    if (typeof g.repo !== "string") return false;
  }
  return true;
}

function parseDueAt(raw: string | null | undefined): Date | null | "invalid" {
  if (raw == null || raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d;
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
  if (!isTaskStatus(status)) {
    return withCors(request, Response.json({ error: "Invalid status" }, { status: 400 }));
  }

  const dueAt = parseDueAt(body.dueAt);
  if (dueAt === "invalid") {
    return withCors(request, Response.json({ error: "Invalid dueAt" }, { status: 400 }));
  }

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true, repoUrls: true },
  });
  if (!project) {
    return withCors(request, Response.json({ error: "Project not found" }, { status: 404 }));
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
      dueAt,
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
