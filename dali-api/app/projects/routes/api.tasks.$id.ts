import type { Route } from "./+types/api.tasks.$id";
import { prisma, Prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { syncIssueForTask } from "../lib/github-task-sync";
import { notifyTaskAssigned } from "../lib/task-notifications.server";
import { parseChecklistInput, type ChecklistItem } from "../lib/task-checklist";

// PATCH  /api/tasks/:id — edit fields not covered by the move endpoint.
//        Status/position changes still go through /api/tasks/:id/move so its
//        column-rebalance logic stays unified. Body is a partial — only
//        present fields are written.
// DELETE /api/tasks/:id — hard-delete. Mirrors MCP delete_task: assignee and
//        comment rows go first (RESTRICT FKs), reminders cascade via their
//        FK, and a linked GitHub issue is left untouched on GH.
//
// Permission model mirrors task creation (isCore === Admin || Core, or a
// project member).

const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

type Body = {
  // ISO timestamp to set, or null to clear the deadline. Absent = no change.
  dueAt?: string | null;
  // Empty string / null clears the title — rejected (title is required).
  title?: string;
  // Null clears the description.
  description?: string | null;
  priority?: Priority;
  // Null clears the domain.
  domainId?: string | null;
  // Null moves the task to the backlog. Must belong to the task's project.
  sprintId?: string | null;
  // Null unlinks the epic. Must belong to the task's project.
  epicId?: string | null;
  // Full replacement checklist. Null or empty clears; item shape is
  // validated separately (parseChecklistInput).
  checklist?: unknown;
  // Full replacement set. Empty array clears assignees.
  assigneeIds?: string[];
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
  if (o.sprintId !== undefined && o.sprintId !== null && typeof o.sprintId !== "string")
    return false;
  if (o.epicId !== undefined && o.epicId !== null && typeof o.epicId !== "string")
    return false;
  if (o.checklist !== undefined && o.checklist !== null && !Array.isArray(o.checklist))
    return false;
  if (o.assigneeIds !== undefined) {
    if (!Array.isArray(o.assigneeIds)) return false;
    if (!o.assigneeIds.every((id) => typeof id === "string")) return false;
  }
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
    select: { id: true, githubIssueNumber: true, projectId: true },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, task.projectId);
  if (!gate.ok) return gate.response;

  if (request.method === "DELETE") {
    // Same rows and order as MCP delete_task; TaskReminder rows cascade via
    // their onDelete: Cascade FK. A linked GitHub issue is left as-is on GH —
    // deleting here only severs the mirror.
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

  // Build a partial update: a key being present (even null) is a write; an
  // absent key is a no-op. Assignee changes are handled separately below
  // because they hit the TaskAssignee join table, not Task itself.
  const data: {
    dueAt?: Date | null;
    title?: string;
    priority?: Priority;
    domainId?: string | null;
    sprintId?: string | null;
    epicId?: string | null;
    checklist?: ChecklistItem[] | typeof Prisma.JsonNull;
  } = {};
  if ("dueAt" in body) {
    const parsed = parseDueAt(body.dueAt);
    if (parsed === "invalid") {
      return withCors(request, Response.json({ error: "Invalid dueAt" }, { status: 400 }));
    }
    data.dueAt = parsed;
  }
  if ("title" in body) {
    const trimmed = (body.title ?? "").trim();
    if (!trimmed) {
      return withCors(request, Response.json({ error: "Title is required" }, { status: 400 }));
    }
    data.title = trimmed;
  }
  // Task description is a live collab doc (task:{id}:description); its plaintext
  // is mirrored to Task.description by the collab store hook, so it is not
  // accepted here.
  if ("priority" in body && body.priority) {
    data.priority = body.priority;
  }
  if ("domainId" in body) {
    data.domainId = body.domainId ?? null;
  }
  // Sprint/epic assignments are validated against the task's own project so
  // one project's member can't attach tasks to another project's board.
  if ("sprintId" in body) {
    const sprintId = body.sprintId ?? null;
    if (sprintId !== null) {
      const sprint = await prisma.sprint.findUnique({
        where: { id: sprintId },
        select: { projectId: true },
      });
      if (!sprint || sprint.projectId !== task.projectId) {
        return withCors(
          request,
          Response.json({ error: "Sprint is not part of this project" }, { status: 400 }),
        );
      }
    }
    data.sprintId = sprintId;
  }
  if ("epicId" in body) {
    const epicId = body.epicId ?? null;
    if (epicId !== null) {
      const epic = await prisma.epic.findUnique({
        where: { id: epicId },
        select: { projectId: true },
      });
      if (!epic || epic.projectId !== task.projectId) {
        return withCors(
          request,
          Response.json({ error: "Epic is not part of this project" }, { status: 400 }),
        );
      }
    }
    data.epicId = epicId;
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

  // Assignees are a full replacement: drop existing rows, then create the
  // new set. Wrapped in a transaction with the Task update so a partial
  // failure leaves the task untouched.
  const wantsAssignees = "assigneeIds" in body && Array.isArray(body.assigneeIds);

  if (Object.keys(data).length === 0 && !wantsAssignees) {
    return withCors(request, Response.json({ ok: true }));
  }

  let addedAssigneeIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.task.update({ where: { id: params.id }, data });
    }
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

  // Mirror to GitHub when this linked task changes a field the issue reflects:
  // the title, its assignees, or any field rendered in the issue body
  // (description + the metadata line — see buildIssueBody in github-task-sync).
  const syncableChanged =
    "title" in body ||
    wantsAssignees ||
    "description" in body ||
    "priority" in body ||
    "dueAt" in body ||
    "domainId" in body ||
    "sprintId" in body ||
    "epicId" in body;
  if (task.githubIssueNumber !== null && syncableChanged) {
    void syncIssueForTask(params.id).catch((err) =>
      console.error(`task ${params.id}: github sync failed`, err),
    );
  }

  return withCors(request, Response.json({ ok: true }));
}
