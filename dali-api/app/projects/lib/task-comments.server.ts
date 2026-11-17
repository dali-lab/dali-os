import { prisma } from "~/lib/db.server";
import { notifyTaskComment } from "./task-notifications.server";

export const TASK_COMMENT_BODY_MAX = 10_000;

export async function addTaskComment(a: { taskId: string; authorId: string; body: string }) {
  const [comment] = await prisma.$transaction([
    prisma.taskComment.create({
      data: { taskId: a.taskId, authorId: a.authorId, body: a.body },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
      },
    }),
    prisma.task.update({ where: { id: a.taskId }, data: { activityAt: new Date() } }),
  ]);

  void notifyTaskComment({ taskId: a.taskId, authorId: a.authorId, body: a.body }).catch((err) =>
    console.error(`task ${a.taskId}: comment notify failed`, err),
  );

  return comment;
}
