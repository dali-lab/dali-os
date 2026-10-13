import type { Route } from "./+types/api.tasks.$id";
import { prisma, Prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { fullName } from "~/lib/display";
import { syncIssueForTask } from "../lib/github-task-sync";
import { notifyTaskAssigned } from "../lib/task-notifications.server";
import { parseChecklistInput, type ChecklistItem } from "../lib/task-checklist";
import { checkSprintTarget, resolveTaskPlacement } from "../lib/sprints.server";

// GET    /api/tasks/:id — minimal card for the doc editor's taskMention hover
//        card: never the description or checklist.
// PATCH  /api/tasks/:id — partial edit of fields the move endpoint doesn't own.
// DELETE /api/tasks/:id — hard delete; a linked GitHub issue is left on GH.

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      status: true,
      projectId: true,
      sprint: { select: { number: true } },
      assignees: {
        take: 1,
        select: { user: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, task.projectId);
  if (!gate.ok) return gate.response;

  const assignee = task.assignees[0] ? { name: fullName(task.assignees[0].user) } : null;
  return withCors(
    request,
    Response.json({
      id: task.id,
      title: task.title,
      status: task.status,
      assignee,
      sprint: task.sprint ? `Sprint ${task.sprint.number}` : null,
    }),
  );
}

const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

type Body = {
  title?: string;
  description?: string | null;
  priority?: Priority;
  domainId?: string | null;
  epicId?: string;
  // Null = move to the backlog.
  sprintId?: string | null;
  checklist?: unknown;
  // Full replacement set.
  assigneeIds?: string[];
};

function isPriority(x: unknown): x is Priority {
  return typeof x === "string" && (PRIORITIES as readonly string[]).includes(x);
}

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.sprintId !== undefined && o.sprintId !== null && typeof o.sprintId !== "string") {
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
  if (o.epicId !== undefined && typeof o.epicId !== "string") return false;
  if (o.checklist !== undefined && o.checklist !== null && !Array.isArray(o.checklist))
    return false;
  if (o.assigneeIds !== undefined) {
    if (!Array.isArray(o.assigneeIds)) return false;
    if (!o.assigneeIds.every((id) => typeof id === "string")) return false;
  }
  return true;
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
    select: {
      id: true,
      githubIssueNumber: true,
      projectId: true,
      epicId: true,
      sprintId: true,
      status: true,
      sprint: { select: { closedAt: true } },
    },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, task.projectId);
  if (!gate.ok) return gate.response;

  if (request.method === "DELETE") {
    await prisma.$transaction([
      prisma.taskAssignee.deleteMany({ where: { taskId: params.id } }),
      prisma.taskComment.deleteMany({ where: { taskId: params.id } }),
      prisma.task.delete({ where: { id: params.id } }),
    ]);
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

  const leavingClosed =
    "sprintId" in body &&
    body.sprintId !== task.sprintId &&
    task.status !== "Done" &&
    task.status !== "Cancelled";
  if (task.sprint?.closedAt && !leavingClosed) {
    return withCors(request, Response.json({ error: "That sprint is closed" }, { status: 409 }));
  }

  // Build a partial update: a key being present (even null) is a write; an
  // absent key is a no-op. Assignee changes are handled separately below
  // because they hit the TaskAssignee join table, not Task itself.
  const data: {
    title?: string;
    description?: string | null;
    priority?: Priority;
    domainId?: string | null;
    epicId?: string;
    sprintId?: string | null;
    checklist?: ChecklistItem[] | typeof Prisma.JsonNull;
  } = {};
  if ("title" in body) {
    const trimmed = (body.title ?? "").trim();
    if (!trimmed) {
      return withCors(request, Response.json({ error: "Title is required" }, { status: 400 }));
    }
    data.title = trimmed;
  }
  if ("description" in body) {
    const trimmed = body.description?.trim() ?? "";
    data.description = trimmed === "" ? null : trimmed;
  }
  if ("priority" in body && body.priority) {
    data.priority = body.priority;
  }
  if ("domainId" in body) {
    data.domainId = body.domainId ?? null;
  }
  if (body.epicId !== undefined && body.epicId !== task.epicId) {
    const placed = await resolveTaskPlacement(task.projectId, { epicId: body.epicId });
    if ("error" in placed) {
      return withCors(request, Response.json(placed, { status: 400 }));
    }
    data.epicId = placed.epicId;
  }
  if ("sprintId" in body && body.sprintId !== task.sprintId) {
    const sprintError = await checkSprintTarget(task.projectId, body.sprintId);
    if (sprintError) {
      return withCors(request, Response.json(sprintError, { status: 400 }));
    }
    data.sprintId = body.sprintId ?? null;
  }
  if ("checklist" in body) {
    if (body.checklist === null) {
      data.checklist = Prisma.JsonNull;
    } else {
      const parsed = parseChecklistInput(body.checklist);
      if (parsed === null) {
        return withCors(
          request,
          Response.json({ error: "Invalid checklist" }, { status: 400 }),
        );
      }
      // Prisma 7 distinguishes "set to JSON null" vs "unset"; use the
      // sentinel for an empty checklist so the column is cleared.
      data.checklist = parsed.length === 0 ? Prisma.JsonNull : parsed;
    }
  }

  const wantsAssignees = "assigneeIds" in body && Array.isArray(body.assigneeIds);

  if (Object.keys(data).length === 0 && !wantsAssignees) {
    return withCors(request, Response.json({ ok: true }));
  }

  let addedAssigneeIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: params.id }, data: { ...data, activityAt: new Date() } });
    if (wantsAssignees) {
      const prior = await tx.taskAssignee.findMany({
        where: { taskId: params.id },
        select: { userId: true },
      });
      const priorIds = new Set(prior.map((p) => p.userId));
      await tx.taskAssignee.deleteMany({ where: { taskId: params.id } });
      const ids = body.assigneeIds ?? [];
      if (ids.length > 0) {
        await tx.taskAssignee.createMany({
          data: ids.map((userId) => ({ taskId: params.id, userId })),
          skipDuplicates: true,
        });
      }
      addedAssigneeIds = ids.filter((id) => !priorIds.has(id));
    }
  });

  if (addedAssigneeIds.length > 0) {
    void notifyTaskAssigned({
      taskId: params.id,
      addedUserIds: addedAssigneeIds,
      actorUserId: gate.auth.user.sub,
    }).catch((err) =>
      console.error(`task ${params.id}: assignment notify failed`, err),
    );
  }

  const syncableChanged =
    "title" in body ||
    wantsAssignees ||
    "description" in body ||
    "priority" in body ||
    "sprintId" in body ||
    "domainId" in body ||
    "epicId" in body;
  if (task.githubIssueNumber !== null && syncableChanged) {
    void syncIssueForTask(params.id).catch((err) =>
      console.error(`task ${params.id}: github sync failed`, err),
    );
  }

  return withCors(request, Response.json({ ok: true }));
}
