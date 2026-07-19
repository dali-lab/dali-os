// Emitters for task-facing notification events (task.assigned, task.comment,
// task.github_update). Each helper loads what it needs and dispatches via
// notify(); callers fire-and-forget so a delivery hiccup never fails the
// underlying write.

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";

function taskLink(projectId: string, taskId: string): string {
  return `/projects/${projectId}?tab=work&task=${taskId}`;
}

const COMMENT_PREVIEW_MAX = 200;

export async function notifyTaskAssigned(args: {
  taskId: string;
  addedUserIds: string[];
  // Omitted for actor-less paths (GitHub webhook). Self-assignment never
  // notifies.
  actorUserId?: string | null;
}): Promise<void> {
  const recipients = args.addedUserIds.filter((id) => id !== args.actorUserId);
  if (recipients.length === 0) return;
  const task = await prisma.task.findUnique({
    where: { id: args.taskId },
    select: {
      id: true,
      title: true,
      projectId: true,
      dueAt: true,
      project: { select: { name: true } },
    },
  });
  if (!task) return;
  await notify({
    eventType: "task.assigned",
    createdByUserId: args.actorUserId ?? null,
    message: {
      title: `Task assigned: ${task.title}`,
      body: `In ${task.project.name}.`,
      link: taskLink(task.projectId, task.id),
      dueAt: task.dueAt,
    },
    recipients: recipients.map((userId) => ({ userId })),
  });
}

export async function notifyTaskComment(args: {
  taskId: string;
  authorId: string;
  body: string;
}): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: args.taskId },
    select: {
      id: true,
      title: true,
      projectId: true,
      assignees: { select: { userId: true } },
    },
  });
  if (!task) return;
  const recipients = task.assignees
    .map((a) => a.userId)
    .filter((id) => id !== args.authorId);
  if (recipients.length === 0) return;
  const preview =
    args.body.length > COMMENT_PREVIEW_MAX
      ? `${args.body.slice(0, COMMENT_PREVIEW_MAX)}…`
      : args.body;
  await notify({
    eventType: "task.comment",
    createdByUserId: args.authorId,
    message: {
      title: `New comment on: ${task.title}`,
      body: preview,
      link: taskLink(task.projectId, task.id),
    },
    recipients: recipients.map((userId) => ({ userId })),
  });
}

export async function notifyTaskGithubUpdate(args: {
  taskId: string;
  action: "closed" | "reopened";
  newStatus: string;
}): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: args.taskId },
    select: {
      id: true,
      title: true,
      projectId: true,
      assignees: { select: { userId: true } },
    },
  });
  if (!task || task.assignees.length === 0) return;
  await notify({
    eventType: "task.github_update",
    message:
      args.action === "closed"
        ? {
            title: `Task closed from GitHub: ${task.title}`,
            body: `The linked issue was closed — status set to ${args.newStatus}.`,
            link: taskLink(task.projectId, task.id),
          }
        : {
            title: `Task reopened from GitHub: ${task.title}`,
            body: `The linked issue was reopened — status set to ${args.newStatus}.`,
            link: taskLink(task.projectId, task.id),
          },
    recipients: task.assignees.map((a) => ({ userId: a.userId })),
  });
}
