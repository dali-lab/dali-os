import type { Route } from "./+types/api.tasks.$id";
import { prisma } from "~/lib/db.server";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { fullName } from "~/lib/display";
import { parseChecklistInput } from "../lib/task-checklist";
import { deleteTask, TaskUpdateError, updateTask, type TaskPatch } from "../lib/task-update.server";

// GET    /api/tasks/:id — minimal task card for the doc editor's taskMention
//        hover card and task block (TaskMentionHoverCard.tsx): status, title,
//        assignees, due date and project name, never the description or
//        checklist. Same access gate as the task modal's edit surface — a
//        chip or block for a task the viewer can't reach falls back to its
//        stored label.
// PATCH  /api/tasks/:id — edit fields not covered by the move endpoint.
//        Status/position changes still go through /api/tasks/:id/move so its
//        column-rebalance logic stays unified. Body is a partial — only
//        present fields are written. `dependsOn` replaces the task's
//        "blocked by" set.
// DELETE /api/tasks/:id — hard-delete. Mirrors MCP manage_task delete: assignee and
//        comment rows go first (RESTRICT FKs), reminders cascade via their
//        FK, and a linked GitHub issue is left untouched on GH.
//
// Permission model mirrors task creation (isCore === Admin || Core, or a
// project member).

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      status: true,
      dueAt: true,
      projectId: true,
      project: { select: { name: true } },
      assignees: {
        select: { user: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, task.projectId);
  if (!gate.ok) return gate.response;

  const assignees = task.assignees.map((a) => ({ id: a.user.id, name: fullName(a.user) }));
  return withCors(
    request,
    Response.json({
      id: task.id,
      title: task.title,
      status: task.status,
      assignee: assignees[0] ? { name: assignees[0].name } : null,
      assignees,
      projectName: task.project.name,
      dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    }),
  );
}

const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

type Body = {
  // ISO timestamp to set, or null to clear the deadline. Absent = no change.
  dueAt?: string | null;
  // Timeline start (planning only — fires no reminders), or null to clear.
  startsAt?: string | null;
  // Empty string / null clears the title — rejected (title is required).
  title?: string;
  // Null clears the description.
  description?: string | null;
  priority?: Priority;
  // Null clears the domain.
  domainId?: string | null;
  // Null unlinks the epic. Must belong to the task's project.
  epicId?: string | null;
  // Null unlinks the parent user story. Must belong to the task's project.
  storyId?: string | null;
  // Full replacement checklist. Null or empty clears; item shape is
  // validated separately (parseChecklistInput).
  checklist?: unknown;
  // Full replacement set. Empty array clears assignees.
  assigneeIds?: string[];
  // Full replacement set of tasks this one waits on. Each must be another task
  // in the same project. Empty array clears.
  dependsOn?: string[];
};

function isPriority(x: unknown): x is Priority {
  return typeof x === "string" && (PRIORITIES as readonly string[]).includes(x);
}

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.dueAt !== undefined && o.dueAt !== null && typeof o.dueAt !== "string") {
    return false;
  }
  if (o.startsAt !== undefined && o.startsAt !== null && typeof o.startsAt !== "string") {
    return false;
  }
  if (o.storyId !== undefined && o.storyId !== null && typeof o.storyId !== "string") {
    return false;
  }
  if (o.title !== undefined && typeof o.title !== "string") return false;
  if (o.description !== undefined && o.description !== null && typeof o.description !== "string")
    return false;
  if (o.priority !== undefined && !isPriority(o.priority)) return false;
  if (
    o.domainId !== undefined &&
    o.domainId !== null &&
    typeof o.domainId !== "string"
  ) {
    return false;
  }
  if (o.epicId !== undefined && o.epicId !== null && typeof o.epicId !== "string")
    return false;
  if (o.checklist !== undefined && o.checklist !== null && !Array.isArray(o.checklist))
    return false;
  if (o.assigneeIds !== undefined) {
    if (!Array.isArray(o.assigneeIds)) return false;
    if (!o.assigneeIds.every((id) => typeof id === "string")) return false;
  }
  if (
    o.dependsOn !== undefined &&
    (!Array.isArray(o.dependsOn) || o.dependsOn.some((v) => typeof v !== "string"))
  )
    return false;
  return true;
}

function parseDueAt(raw: string | null | undefined): Date | null | "invalid" {
  if (raw === undefined) return "invalid"; // shouldn't be called without a key
  if (raw === null || raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d;
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "PATCH" && request.method !== "DELETE") {
    return withCors(
      request,
      Response.json({ error: "Method not allowed" }, { status: 405 }),
    );
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

  if (request.method === "DELETE") {
    await deleteTask({ taskId: task.id, actorId: gate.auth.user.sub, request });
    return withCors(request, Response.json({ ok: true }));
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

  const patch: TaskPatch = {};
  if ("dueAt" in body) {
    const parsed = parseDueAt(body.dueAt);
    if (parsed === "invalid") {
      return withCors(request, Response.json({ error: "Invalid dueAt" }, { status: 400 }));
    }
    patch.dueAt = parsed;
  }
  if ("startsAt" in body) {
    const parsed = parseDueAt(body.startsAt);
    if (parsed === "invalid") {
      return withCors(request, Response.json({ error: "Invalid startsAt" }, { status: 400 }));
    }
    patch.startsAt = parsed;
  }
  if ("title" in body) {
    const trimmed = (body.title ?? "").trim();
    if (!trimmed) {
      return withCors(request, Response.json({ error: "Title is required" }, { status: 400 }));
    }
    patch.title = trimmed;
  }
  if ("description" in body) {
    const trimmed = body.description?.trim() ?? "";
    patch.description = trimmed === "" ? null : trimmed;
  }
  if ("priority" in body && body.priority) patch.priority = body.priority;
  if ("domainId" in body) patch.domainId = body.domainId ?? null;
  if ("epicId" in body) patch.epicId = body.epicId ?? null;
  if ("storyId" in body) patch.storyId = body.storyId ?? null;
  if ("checklist" in body) {
    if (body.checklist === null) {
      patch.checklist = null;
    } else {
      const parsed = parseChecklistInput(body.checklist);
      if (parsed === null) {
        return withCors(request, Response.json({ error: "Invalid checklist" }, { status: 400 }));
      }
      patch.checklist = parsed;
    }
  }
  if (Array.isArray(body.assigneeIds)) patch.assigneeUserIds = body.assigneeIds;
  if (body.dependsOn !== undefined) patch.dependsOnTaskIds = body.dependsOn;

  try {
    await updateTask({ taskId: task.id, actorId: gate.auth.user.sub, patch });
  } catch (err) {
    if (err instanceof TaskUpdateError) {
      return withCors(request, Response.json({ error: err.message }, { status: err.status }));
    }
    throw err;
  }

  return withCors(request, Response.json({ ok: true }));
}
