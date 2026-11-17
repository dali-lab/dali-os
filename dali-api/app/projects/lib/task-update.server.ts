import { prisma, Prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { syncIssueForTask } from "./github-task-sync";
import { notifyTaskAssigned } from "./task-notifications.server";
import type { ChecklistItem } from "./task-checklist";

export class TaskUpdateError extends Error {
  constructor(
    message: string,
    public status: 400 | 404,
  ) {
    super(message);
    this.name = "TaskUpdateError";
  }
}

export type Priority = "Low" | "Normal" | "High" | "Urgent";

export type TaskPatch = Partial<{
  title: string;
  description: string | null;
  priority: Priority;
  startsAt: Date | null;
  dueAt: Date | null;
  epicId: string | null;
  storyId: string | null;
  domainId: string | null;
  checklist: ChecklistItem[] | null;
  assigneeUserIds: string[];
  dependsOnTaskIds: string[];
}>;

const has = (patch: TaskPatch, key: keyof TaskPatch) => patch[key] !== undefined;

export async function updateTask(a: {
  taskId: string;
  actorId: string;
  patch: TaskPatch;
}): Promise<{ noop: boolean }> {
  const { taskId, actorId, patch } = a;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, githubIssueNumber: true, projectId: true, epicId: true, storyId: true },
  });
  if (!task) throw new TaskUpdateError("Task not found", 404);

  const data: {
    title?: string;
    description?: string | null;
    priority?: Priority;
    startsAt?: Date | null;
    dueAt?: Date | null;
    domainId?: string | null;
    epicId?: string | null;
    storyId?: string | null;
    checklist?: ChecklistItem[] | typeof Prisma.JsonNull;
  } = {};
  if (has(patch, "title")) data.title = patch.title;
  if (has(patch, "description")) data.description = patch.description;
  if (has(patch, "priority")) data.priority = patch.priority;
  if (has(patch, "startsAt")) data.startsAt = patch.startsAt;
  if (has(patch, "dueAt")) data.dueAt = patch.dueAt;
  if (has(patch, "domainId")) data.domainId = patch.domainId;
  if (has(patch, "checklist")) {
    data.checklist = patch.checklist && patch.checklist.length > 0 ? patch.checklist : Prisma.JsonNull;
  }

  const epicInPatch = has(patch, "epicId");
  const storyInPatch = has(patch, "storyId");
  if (epicInPatch || storyInPatch) {
    const currentEpicId = task.epicId ?? null;
    const currentStoryId = task.storyId ?? null;
    let nextEpicId = epicInPatch ? (patch.epicId ?? null) : currentEpicId;
    let nextStoryId = storyInPatch ? (patch.storyId ?? null) : currentStoryId;

    if (nextStoryId !== null) {
      const story = await prisma.userStory.findUnique({
        where: { id: nextStoryId },
        select: { epicId: true, epic: { select: { projectId: true } } },
      });
      if (!story || story.epic.projectId !== task.projectId) {
        throw new TaskUpdateError("Story is not part of this project", 400);
      }
      if (storyInPatch) {
        nextEpicId = story.epicId;
      } else if (nextEpicId !== story.epicId) {
        nextStoryId = null;
      }
    }

    if (nextStoryId === null && nextEpicId !== null && nextEpicId !== currentEpicId) {
      const epic = await prisma.epic.findUnique({
        where: { id: nextEpicId },
        select: { projectId: true },
      });
      if (!epic || epic.projectId !== task.projectId) {
        throw new TaskUpdateError("Epic is not part of this project", 400);
      }
    }

    if (nextEpicId !== currentEpicId) data.epicId = nextEpicId;
    if (nextStoryId !== currentStoryId) data.storyId = nextStoryId;
  }

  const assigneeIds = patch.assigneeUserIds;
  const dependsOn =
    patch.dependsOnTaskIds === undefined
      ? null
      : [...new Set(patch.dependsOnTaskIds)].filter((x) => x && x !== taskId);
  if (dependsOn && dependsOn.length > 0) {
    const valid = await prisma.task.count({
      where: { id: { in: dependsOn }, projectId: task.projectId },
    });
    if (valid !== dependsOn.length) throw new TaskUpdateError("Invalid dependency target", 400);
  }

  if (Object.keys(data).length === 0 && !assigneeIds && !dependsOn) return { noop: true };

  let addedAssigneeIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: taskId }, data: { ...data, activityAt: new Date() } });
    if (assigneeIds) {
      const prior = await tx.taskAssignee.findMany({
        where: { taskId },
        select: { userId: true },
      });
      const priorIds = new Set(prior.map((p) => p.userId));
      await tx.taskAssignee.deleteMany({ where: { taskId } });
      if (assigneeIds.length > 0) {
        await tx.taskAssignee.createMany({
          data: assigneeIds.map((userId) => ({ taskId, userId })),
          skipDuplicates: true,
        });
      }
      addedAssigneeIds = assigneeIds.filter((id) => !priorIds.has(id));
    }
    if (dependsOn) {
      await tx.taskDependency.deleteMany({ where: { taskId } });
      if (dependsOn.length > 0) {
        await tx.taskDependency.createMany({
          data: dependsOn.map((depId) => ({ taskId, dependsOnTaskId: depId })),
        });
      }
    }
  });

  if (addedAssigneeIds.length > 0) {
    void notifyTaskAssigned({ taskId, addedUserIds: addedAssigneeIds, actorUserId: actorId }).catch(
      (err) => console.error(`task ${taskId}: assignment notify failed`, err),
    );
  }

  const syncableChanged =
    "title" in data ||
    !!assigneeIds ||
    "description" in data ||
    "priority" in data ||
    "dueAt" in data ||
    "domainId" in data ||
    "epicId" in data;
  if (task.githubIssueNumber !== null && syncableChanged) {
    void syncIssueForTask(taskId).catch((err) =>
      console.error(`task ${taskId}: github sync failed`, err),
    );
  }

  return { noop: false };
}

export async function deleteTask(a: {
  taskId: string;
  actorId: string;
  request?: Request;
}): Promise<{ title: string; projectId: string }> {
  const task = await prisma.task.findUnique({
    where: { id: a.taskId },
    select: { id: true, title: true, projectId: true },
  });
  if (!task) throw new TaskUpdateError("Task not found", 404);

  await prisma.$transaction([
    prisma.taskAssignee.deleteMany({ where: { taskId: a.taskId } }),
    prisma.taskComment.deleteMany({ where: { taskId: a.taskId } }),
    prisma.task.delete({ where: { id: a.taskId } }),
  ]);
  await logAuditEvent({
    action: "task.delete",
    userId: a.actorId,
    targetId: a.taskId,
    metadata: { title: task.title, projectId: task.projectId },
    request: a.request,
  });
  return { title: task.title, projectId: task.projectId };
}
