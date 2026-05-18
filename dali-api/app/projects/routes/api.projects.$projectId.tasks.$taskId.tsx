import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId.tasks.$taskId";
import { requireAuth } from "~/lib/auth";
import { requireProjectEditor } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { Prisma } from "~/generated/prisma/client";
import { parseJson } from "~/lib/validate";
import { emitEvent } from "~/lib/notifications";

const PRIORITY = ["Low", "Normal", "High", "Urgent"] as const;
const STATUS = ["Todo", "InProgress", "InReview", "Done", "Cancelled"] as const;

const UpdateTaskSchema = z.object({
  title: z.string().trim().min(1).max(280).optional(),
  sprintId: z.string().nullable().optional(),
  epicId: z.string().nullable().optional(),
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  position: z.number().int().min(0).optional(),
  assigneeIds: z.array(z.string()).optional(),
  checklist: z
    .array(z.object({ text: z.string(), done: z.boolean() }))
    .nullable()
    .optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectEditor(auth.user.sub, params.projectId!);

  const taskId = params.taskId!;
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
    include: { assignees: true },
  });
  if (!existing || existing.projectId !== params.projectId) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  if (request.method === "DELETE") {
    await prisma.task.delete({ where: { id: taskId } });
    return Response.json({ ok: true });
  }

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, UpdateTaskSchema);
  if (body instanceof Response) return body;

  const data: Prisma.TaskUncheckedUpdateInput = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.sprintId !== undefined) data.sprintId = body.sprintId;
  if (body.epicId !== undefined) data.epicId = body.epicId;
  if (body.status !== undefined) data.status = body.status;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.position !== undefined) data.position = body.position;
  if (body.checklist !== undefined) {
    data.checklist =
      body.checklist === null
        ? Prisma.JsonNull
        : (body.checklist as Prisma.InputJsonValue);
  }

  let assigneeChanges: { added: string[]; removed: string[] } | null = null;
  if (body.assigneeIds !== undefined) {
    const existingIds = new Set(existing.assignees.map((a) => a.userId));
    const nextIds = new Set(body.assigneeIds);
    const added = body.assigneeIds.filter((id) => !existingIds.has(id));
    const removed = [...existingIds].filter((id) => !nextIds.has(id));
    assigneeChanges = { added, removed };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.task.update({
      where: { id: taskId },
      data,
      include: { assignees: true },
    });

    if (assigneeChanges) {
      if (assigneeChanges.removed.length > 0) {
        await tx.taskAssignee.deleteMany({
          where: {
            taskId,
            userId: { in: assigneeChanges.removed },
          },
        });
      }
      if (assigneeChanges.added.length > 0) {
        await tx.taskAssignee.createMany({
          data: assigneeChanges.added.map((userId) => ({ taskId, userId })),
          skipDuplicates: true,
        });
      }
    }
    return t;
  });

  if (assigneeChanges) {
    const addedRecipients = assigneeChanges.added.filter((id) => id !== auth.user.sub);
    if (addedRecipients.length > 0) {
      await emitEvent({
        type: "task.assigned",
        recipients: addedRecipients,
        payload: {
          projectId: params.projectId,
          taskId,
          title: updated.title,
        },
        inbox: {
          kind: "General",
          title: `Assigned: ${updated.title}`,
          link: `/projects/${params.projectId}/tasks`,
          createdByUserId: auth.user.sub,
        },
      });
    }
    const removedRecipients = assigneeChanges.removed.filter((id) => id !== auth.user.sub);
    if (removedRecipients.length > 0) {
      await emitEvent({
        type: "task.unassigned",
        recipients: removedRecipients,
        payload: {
          projectId: params.projectId,
          taskId,
          title: updated.title,
        },
      });
    }
  }

  return Response.json(updated);
}
