import { prisma } from "~/lib/db.server";

export class TaskFileError extends Error {
  constructor(
    message: string,
    public status: 400 | 404,
  ) {
    super(message);
    this.name = "TaskFileError";
  }
}

async function bumpActivity(taskId: string) {
  await prisma.task.update({ where: { id: taskId }, data: { activityAt: new Date() } });
}

export async function linkTaskFile(a: { taskId: string; fileId: string }) {
  const task = await prisma.task.findUnique({
    where: { id: a.taskId },
    select: { id: true, projectId: true },
  });
  if (!task) throw new TaskFileError("Task not found", 404);

  const file = await prisma.projectFile.findUnique({
    where: { id: a.fileId },
    select: {
      id: true,
      title: true,
      projectId: true,
      archivedAt: true,
      _count: { select: { versions: true } },
    },
  });
  if (!file || file.archivedAt !== null || file.projectId !== task.projectId) {
    throw new TaskFileError("File not found", 404);
  }

  const { count } = await prisma.taskFileLink.createMany({
    data: [{ taskId: task.id, fileId: file.id }],
    skipDuplicates: true,
  });
  if (count > 0) await bumpActivity(task.id);

  return { linked: count > 0, file: { id: file.id, title: file.title, versionCount: file._count.versions } };
}

export async function unlinkTaskFile(a: { taskId: string; fileId: string }) {
  const { count } = await prisma.taskFileLink.deleteMany({
    where: { taskId: a.taskId, fileId: a.fileId },
  });
  if (count > 0) await bumpActivity(a.taskId);
  return { unlinked: count > 0 };
}
