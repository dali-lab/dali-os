import type { Route } from "./+types/api.projects.$id.tasks";
import { prisma } from "~/lib/db.server";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { createTask, TaskCreateError } from "../lib/task-create.server";
import { USER_NAME_SELECT } from "~/lib/prisma-shapes";
import { fullName } from "~/lib/display";
import { decodeCursor, keysetAfter, keysetPage } from "~/lib/pagination";

export const ARCHIVED_TASKS_PAGE_SIZE = 50;

// POST /api/projects/:id/tasks

type Body = {
  title: string;
  description?: string | null;
  status?: string;
  epicId?: string | null;
  storyId?: string | null;
  startsAt?: string | null;
  dueAt?: string | null;
  github?: { repo: string };
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (o.description != null && typeof o.description !== "string") return false;
  if (o.status !== undefined && typeof o.status !== "string") return false;
  if (o.epicId != null && typeof o.epicId !== "string") return false;
  if (o.storyId != null && typeof o.storyId !== "string") return false;
  if (o.startsAt != null && typeof o.startsAt !== "string") return false;
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

// GET /api/projects/:id/tasks — list a project's archived tasks
// (board Archive + weekly auto-archive of Done/Cancelled), newest-archived
// first. Backs the board's "Archived" modal, so it stays a lazy fetch rather
// than bloating the project loader (which only ever loads the live,
// non-archived board). Paged by ?cursor=; `tasks` is one page and
// `nextCursor` is null on the last.
export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const gate = await requireProjectEditAccess(request, params.id!);
  if (!gate.ok) return gate.response;

  const cursor = decodeCursor(new URL(request.url).searchParams.get("cursor"));
  const rows = await prisma.task.findMany({
    where: {
      AND: [{ projectId: params.id, archivedAt: { not: null } }, keysetAfter("archivedAt", cursor)],
    },
    orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
    take: ARCHIVED_TASKS_PAGE_SIZE + 1,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueAt: true,
      archivedAt: true,
      domain: { select: { id: true, displayName: true } },
      assignees: { select: { user: { select: USER_NAME_SELECT } } },
    },
  });

  const page = keysetPage(rows, ARCHIVED_TASKS_PAGE_SIZE, (t) => ({
    at: t.archivedAt!.toISOString(),
    id: t.id,
  }));
  const tasks = page.items.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    archivedAt: t.archivedAt!.toISOString(),
    domain: t.domain ? { id: t.domain.id, name: t.domain.displayName } : null,
    assignees: t.assignees.map((a) => ({ id: a.user.id, name: fullName(a.user) })),
  }));

  return withCors(request, Response.json({ tasks, nextCursor: page.nextCursor }));
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

  const dueAt = parseDueAt(body.dueAt);
  if (dueAt === "invalid") {
    return withCors(request, Response.json({ error: "Invalid dueAt" }, { status: 400 }));
  }
  const startsAt = parseDueAt(body.startsAt);
  if (startsAt === "invalid") {
    return withCors(request, Response.json({ error: "Invalid startsAt" }, { status: 400 }));
  }

  const status = body.status ?? "Todo";
  if (status !== "Backlog" && dueAt == null) {
    return withCors(
      request,
      Response.json({ error: "Give the task a deadline, or create it in Backlog." }, { status: 400 }),
    );
  }

  let task: { id: string };
  try {
    task = await createTask({
      projectId: params.id!,
      actorId: auth.user.sub,
      title: body.title,
      description: body.description,
      status,
      startsAt,
      dueAt,
      epicId: body.epicId,
      storyId: body.storyId,
      mirrorToGithubRepo: body.github?.repo,
    });
  } catch (err) {
    if (err instanceof TaskCreateError) {
      return withCors(request, Response.json({ error: err.message }, { status: err.status }));
    }
    throw err;
  }

  return withCors(request, Response.json({ id: task.id }));
}
