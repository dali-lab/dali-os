import type { Route } from "./+types/api.tasks.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { syncIssueForTask } from "../lib/github-task-sync";

// PATCH /api/tasks/:id
//
// Edit fields on an existing task that aren't covered by the move endpoint.
// Status/position changes still go through /api/tasks/:id/move so its
// column-rebalance logic stays unified. Body is a partial — only present
// fields are written. Permission model mirrors task creation
// (isCore === Admin || Core).

const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

type Body = {
  // ISO timestamp to set, or null to clear the deadline. Absent = no change.
  dueAt?: string | null;
  // Empty string / null clears the title — rejected (title is required).
  title?: string;
  priority?: Priority;
  // Null clears the domain.
  domainId?: string | null;
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

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "PATCH") {
    return withCors(
      request,
      Response.json({ error: "Method not allowed" }, { status: 405 }),
    );
  }
  if (!(await isCore(auth.user.sub))) {
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

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: { id: true, githubIssueNumber: true },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }

  // Build a partial update: a key being present (even null) is a write; an
  // absent key is a no-op. Assignee changes are handled separately below
  // because they hit the TaskAssignee join table, not Task itself.
  const data: {
    dueAt?: Date | null;
    title?: string;
    priority?: Priority;
    domainId?: string | null;
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

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.task.update({ where: { id: params.id }, data });
    }
    if (wantsAssignees) {
      await tx.taskAssignee.deleteMany({ where: { taskId: params.id } });
      const ids = body.assigneeIds ?? [];
      if (ids.length > 0) {
        await tx.taskAssignee.createMany({
          data: ids.map((userId) => ({ taskId: params.id, userId })),
          skipDuplicates: true,
        });
      }
    }
  });

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
