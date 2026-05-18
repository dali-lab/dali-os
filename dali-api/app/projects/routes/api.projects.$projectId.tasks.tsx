import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId.tasks";
import { requireAuth } from "~/lib/auth";
import { requireProjectEditor } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { parseJson } from "~/lib/validate";
import { emitEvent } from "~/lib/notifications";
import { listTasks } from "~/projects/lib/queries";

const PRIORITY = ["Low", "Normal", "High", "Urgent"] as const;
const STATUS = ["Todo", "InProgress", "InReview", "Done", "Cancelled"] as const;

const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(280),
  sprintId: z.string().nullable().optional(),
  epicId: z.string().nullable().optional(),
  status: z.enum(STATUS).default("Todo"),
  priority: z.enum(PRIORITY).default("Normal"),
  assigneeIds: z.array(z.string()).default([]),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectEditor(auth.user.sub, params.projectId!);
  return Response.json(await listTasks(params.projectId!));
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectEditor(auth.user.sub, params.projectId!);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await parseJson(request, CreateTaskSchema);
  if (body instanceof Response) return body;

  // Position: append to bottom of the target status column.
  const maxPos = await prisma.task.findFirst({
    where: {
      projectId: params.projectId!,
      sprintId: body.sprintId ?? null,
      status: body.status,
    },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const task = await prisma.task.create({
    data: {
      projectId: params.projectId!,
      title: body.title,
      sprintId: body.sprintId ?? null,
      epicId: body.epicId ?? null,
      status: body.status,
      priority: body.priority,
      position: (maxPos?.position ?? -1) + 1,
      createdById: auth.user.sub,
      assignees: body.assigneeIds.length
        ? { create: body.assigneeIds.map((userId) => ({ userId })) }
        : undefined,
    },
    include: { assignees: true },
  });

  if (body.assigneeIds.length > 0) {
    const recipients = body.assigneeIds.filter((id) => id !== auth.user.sub);
    if (recipients.length > 0) {
      await emitEvent({
        type: "task.assigned",
        recipients,
        payload: {
          projectId: params.projectId,
          taskId: task.id,
          title: task.title,
        },
        inbox: {
          kind: "General",
          title: `Assigned: ${task.title}`,
          link: `/projects/${params.projectId}/tasks`,
          createdByUserId: auth.user.sub,
        },
      });
    }
  }

  return Response.json(task, { status: 201 });
}
