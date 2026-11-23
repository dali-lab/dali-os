import { prisma } from "~/lib/db.server";
import { canEditProject } from "./access";
import { addTaskComment } from "~/projects/lib/task-comments.server";

type Input = { taskId: string; body: string };

export class AddTaskCommentError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "AddTaskCommentError";
  }
}

export async function runAddTaskComment(callerId: string, input: Input) {
  const body = input.body.trim();
  if (!body) throw new AddTaskCommentError("Body is required", 400);

  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { id: true, projectId: true, assignees: { select: { userId: true } } },
  });
  if (!task) throw new AddTaskCommentError("Task not found", 404);

  const isAssignee = task.assignees.some((a) => a.userId === callerId);
  if (!isAssignee && !(await canEditProject(callerId, task.projectId))) {
    throw new AddTaskCommentError("Forbidden", 403);
  }

  const comment = await addTaskComment({ taskId: input.taskId, authorId: callerId, body });

  return {
    id: comment.id,
    taskId: input.taskId,
    createdAt: comment.createdAt.toISOString(),
  };
}
