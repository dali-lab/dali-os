// Emitters for task-facing notification events (task.assigned, task.comment,
// task.status_changed, task.github_update — plus pagedoc.mention, the app-wide
// @-mention event, for handles named in a comment). Each helper loads what it needs
// and dispatches via notify(); callers fire-and-forget so a delivery hiccup
// never fails the underlying write.

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { extractHandlesFromText, notifyMentions, resolveHandles } from "~/lib/mentions";
import { TASK_STATUS_LABELS } from "./task-board";
import { currentProjectParticipantIds } from "./project-members.server";

function taskLink(projectId: string, taskId: string): string {
  return `/projects/${projectId}?tab=board&task=${taskId}`;
}

// Drop anyone no longer on the project — a historical task assignee who has
// since rolled off should stop getting the project's task activity.
async function onProject(
  projectId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return userIds;
  const members = await currentProjectParticipantIds(projectId);
  return userIds.filter((id) => members.has(id));
}

const COMMENT_PREVIEW_MAX = 200;

export async function notifyTaskAssigned(args: {
  taskId: string;
  addedUserIds: string[];
  // Omitted for actor-less paths (GitHub webhook). Self-assignment never
  // notifies.
  actorUserId?: string | null;
}): Promise<void> {
  const added = args.addedUserIds.filter((id) => id !== args.actorUserId);
  if (added.length === 0) return;
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
  const recipients = await onProject(task.projectId, added);
  if (recipients.length === 0) return;
  await notify({
    eventType: "task.assigned",
    createdByUserId: args.actorUserId ?? null,
    message: {
      vars: { itemTitle: task.title, contextName: task.project.name },
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

  // "@handle" tokens in the body notify the named member directly. Deliberate,
  // so unlike ambient comment activity it isn't gated on project membership —
  // the board is readable by any member, which is who the typeahead offers.
  const mentioned = new Set(
    (await resolveHandles(extractHandlesFromText(args.body))).filter(
      (id) => id !== args.authorId,
    ),
  );

  // A mentioned assignee gets the mention instead of the comment event, not both.
  const recipients = await onProject(
    task.projectId,
    task.assignees
      .map((a) => a.userId)
      .filter((id) => id !== args.authorId && !mentioned.has(id)),
  );
  if (recipients.length > 0) {
    const preview =
      args.body.length > COMMENT_PREVIEW_MAX
        ? `${args.body.slice(0, COMMENT_PREVIEW_MAX)}…`
        : args.body;
    await notify({
      eventType: "task.comment",
      createdByUserId: args.authorId,
      message: {
        vars: { itemTitle: task.title, itemDetail: preview },
        link: taskLink(task.projectId, task.id),
      },
      recipients: recipients.map((userId) => ({ userId })),
    });
  }

  if (mentioned.size > 0) {
    await notifyMentions({
      recipientUserIds: [...mentioned],
      actorId: args.authorId,
      link: taskLink(task.projectId, task.id),
      copyKey: "mention.task",
      itemTitle: task.title,
      preview: args.body,
    });
  }
}

export async function notifyTaskStatusChanged(
  taskId: string,
  // The user who moved the task; assignees other than them are notified.
  actorUserId: string | null,
  newStatus: string,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      projectId: true,
      assignees: { select: { userId: true } },
      project: { select: { name: true } },
    },
  });
  if (!task) return;
  const recipients = await onProject(
    task.projectId,
    task.assignees.map((a) => a.userId).filter((id) => id !== actorUserId),
  );
  if (recipients.length === 0) return;
  const label =
    (TASK_STATUS_LABELS as Record<string, string>)[newStatus] ?? newStatus;
  await notify({
    eventType: "task.status_changed",
    createdByUserId: actorUserId,
    message: {
      vars: {
        itemTitle: task.title,
        contextName: task.project.name,
        statusLabel: label,
      },
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
  const recipients = await onProject(
    task.projectId,
    task.assignees.map((a) => a.userId),
  );
  if (recipients.length === 0) return;
  await notify({
    eventType: "task.github_update",
    message:
      args.action === "closed"
        ? {
            copyKey: "task.github_closed" as const,
            vars: { itemTitle: task.title, statusLabel: args.newStatus },
            link: taskLink(task.projectId, task.id),
          }
        : {
            copyKey: "task.github_reopened" as const,
            vars: { itemTitle: task.title, statusLabel: args.newStatus },
            link: taskLink(task.projectId, task.id),
          },
    recipients: recipients.map((userId) => ({ userId })),
  });
}
