import { prisma } from "~/lib/db.server";
import type { Priority } from "~/generated/prisma/client";
import { isTaskStatus, type TaskStatus } from "./task-board";
import { createIssueForTask, normalizeRepo } from "./github-task-sync";
import { notifyTaskAssigned } from "./task-notifications.server";
import { nextColumnPosition } from "./task-position.server";

export class TaskCreateError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404,
  ) {
    super(message);
    this.name = "TaskCreateError";
  }
}

export type CreateTaskArgs = {
  projectId: string;
  actorId: string;
  title: string;
  description?: string | null;
  status?: string;
  priority?: Priority;
  startsAt?: Date | null;
  dueAt?: Date | null;
  epicId?: string | null;
  storyId?: string | null;
  domainId?: string | null;
  assigneeUserIds?: string[];
  mirrorToGithubRepo?: string | null;
  sourceRecordingId?: string | null;
};

export async function createTask(
  a: CreateTaskArgs,
): Promise<{ id: string; status: TaskStatus; position: number }> {
  const title = a.title.trim();
  if (!title) throw new TaskCreateError("Title is required", 400);

  const status = a.status ?? (a.dueAt ? "Todo" : "Backlog");
  if (!isTaskStatus(status)) throw new TaskCreateError("Invalid status", 400);

  const project = await prisma.project.findUnique({
    where: { id: a.projectId },
    select: { id: true, repoUrls: true },
  });
  if (!project) throw new TaskCreateError("Project not found", 404);

  // A story pins its epic, so a task never carries an independent epic and story.
  let epicId = a.epicId || null;
  const storyId = a.storyId || null;
  if (storyId) {
    const story = await prisma.userStory.findUnique({
      where: { id: storyId },
      select: { epicId: true, epic: { select: { projectId: true } } },
    });
    if (!story || story.epic.projectId !== a.projectId) {
      throw new TaskCreateError("Story is not part of this project", 400);
    }
    epicId = story.epicId;
  } else if (epicId) {
    const epic = await prisma.epic.findUnique({ where: { id: epicId }, select: { projectId: true } });
    if (!epic || epic.projectId !== a.projectId) {
      throw new TaskCreateError("Epic is not part of this project", 400);
    }
  }

  let githubRepo: string | null = null;
  if (a.mirrorToGithubRepo) {
    const requested = normalizeRepo(a.mirrorToGithubRepo);
    if (!requested) throw new TaskCreateError("Invalid GitHub repo", 400);
    const allowed = project.repoUrls.map(normalizeRepo).filter((r): r is string => !!r);
    if (!allowed.includes(requested)) {
      throw new TaskCreateError("That GitHub repo is not one of the project's repos", 400);
    }
    githubRepo = requested;
  }

  const position = await nextColumnPosition(a.projectId, status);
  const description = a.description?.trim() || null;
  const assigneeUserIds = a.assigneeUserIds ?? [];

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        projectId: a.projectId,
        title,
        description,
        status,
        position,
        epicId,
        storyId,
        dueAt: a.dueAt ?? null,
        startsAt: a.startsAt ?? null,
        createdById: a.actorId,
        ...(a.priority ? { priority: a.priority } : {}),
        ...(a.domainId ? { domainId: a.domainId } : {}),
        ...(a.sourceRecordingId ? { sourceRecordingId: a.sourceRecordingId } : {}),
      },
      select: { id: true },
    });
    if (assigneeUserIds.length > 0) {
      await tx.taskAssignee.createMany({
        data: assigneeUserIds.map((userId) => ({ taskId: created.id, userId })),
        skipDuplicates: true,
      });
    }
    return created;
  });

  if (githubRepo) {
    void createIssueForTask(task.id, githubRepo).catch((err) =>
      console.error(`task ${task.id}: github mirror failed`, err),
    );
  }
  if (assigneeUserIds.length > 0) {
    void notifyTaskAssigned({
      taskId: task.id,
      addedUserIds: assigneeUserIds,
      actorUserId: a.actorId,
    }).catch((err) => console.error(`task ${task.id}: assignment notify failed`, err));
  }

  return { id: task.id, status, position };
}
