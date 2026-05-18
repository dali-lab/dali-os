import { z } from "zod";
import type { Route } from "./+types/api.projects.$projectId.tasks.$taskId.comments";
import { requireAuth } from "~/lib/auth";
import { requireProjectEditor } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { parseJson } from "~/lib/validate";
import { emitEvent } from "~/lib/notifications";

const CreateCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectEditor(auth.user.sub, params.projectId!);

  const comments = await prisma.taskComment.findMany({
    where: { taskId: params.taskId! },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return Response.json(comments);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireProjectEditor(auth.user.sub, params.projectId!);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const task = await prisma.task.findUnique({
    where: { id: params.taskId! },
    include: { assignees: true },
  });
  if (!task || task.projectId !== params.projectId) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const body = await parseJson(request, CreateCommentSchema);
  if (body instanceof Response) return body;

  const comment = await prisma.taskComment.create({
    data: {
      taskId: task.id,
      authorId: auth.user.sub,
      body: body.body,
    },
    include: {
      author: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Notify assignees + task creator (deduped, not the actor)
  const recipientSet = new Set<string>(task.assignees.map((a) => a.userId));
  recipientSet.add(task.createdById);
  recipientSet.delete(auth.user.sub);
  if (recipientSet.size > 0) {
    await emitEvent({
      type: "task.commented",
      recipients: [...recipientSet],
      payload: {
        projectId: params.projectId,
        taskId: task.id,
        commentId: comment.id,
        title: task.title,
      },
      inbox: {
        kind: "General",
        title: `New comment on ${task.title}`,
        body: body.body.length > 120 ? body.body.slice(0, 117) + "..." : body.body,
        link: `/projects/${params.projectId}/tasks`,
        createdByUserId: auth.user.sub,
      },
    });
  }

  return Response.json(comment, { status: 201 });
}
