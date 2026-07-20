import type { Route } from "./+types/api.tasks.$id";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { syncIssueForTask } from "../lib/github-task-sync";
import { notifyTaskAssigned } from "../lib/task-notifications.server";
import { isTaskStatus, type TaskStatus } from "../lib/task-board";

// PATCH /api/tasks/:id
//
// Edit fields on an existing task. Drag-reordering still goes through
// /api/tasks/:id/move so its column-rebalance (position) logic stays unified,
// but a plain status set from the modal's Status dropdown — and manual
// archive/un-archive — come through here. Body is a partial — only present
// fields are written. Permission model mirrors task creation
// (isCore === Admin || Core).

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
  // Full replacement set. Empty array clears assignees.
  assigneeIds?: string[];
  // Manual status set from the task modal's Status dropdown. (Drag between
  // columns still goes through /move, which also rebalances position.)
  status?: TaskStatus;
  // Manual archive toggle from the modal. true = archive now (drops off the
  // board), false = un-archive.
  archived?: boolean;
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
  if (o.assigneeIds !== undefined) {
    if (!Array.isArray(o.assigneeIds)) return false;
    if (!o.assigneeIds.every((id) => typeof id === "string")) return false;
  }
  if (o.status !== undefined && !isTaskStatus(o.status)) return false;
  if (o.archived !== undefined && typeof o.archived !== "boolean") return false;
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

  // DELETE /api/tasks/:id — remove the task and its owned rows. TaskAssignee
  // and TaskComment have no onDelete: Cascade, so drop them first; TaskReminder
  // cascades at the DB. Mirrors the MCP delete_task tool. The mirrored GitHub
  // issue (if any) is intentionally left in place.
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

  // Build a partial update: a key being present (even null) is a write; an
  // absent key is a no-op. Assignee changes are handled separately below
  // because they hit the TaskAssignee join table, not Task itself.
  const data: {
    dueAt?: Date | null;
    title?: string;
    description?: string | null;
    priority?: Priority;
    domainId?: string | null;
    status?: TaskStatus;
    archivedAt?: Date | null;
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
  if ("description" in body) {
    const trimmed = body.description?.trim() ?? "";
    data.description = trimmed === "" ? null : trimmed;
  }
  if ("status" in body && body.status) {
    data.status = body.status;
  }
  if ("archived" in body) {
    data.archivedAt = body.archived ? new Date() : null;
  }
  if ("priority" in body && body.priority) {
    data.priority = body.priority;
  }
  if ("domainId" in body) {
    data.domainId = body.domainId ?? null;
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

  // Mirror title/assignee changes to GitHub when this task is linked. Other
  // edited fields (priority, dueAt, domainId) don't have a GH equivalent.
  const syncableChanged = "title" in body || wantsAssignees;
  if (task.githubIssueNumber !== null && syncableChanged) {
    void syncIssueForTask(params.id).catch((err) =>
      console.error(`task ${params.id}: github sync failed`, err),
    );
  }

  return withCors(request, Response.json({ ok: true }));
}
