// MCP `add_task_comment` — append a comment to a task. Permission: task
// assignees can comment on their own tasks; Core can comment on anything.
// Mirrors the spirit of update_task_status — self-service is allowed.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";
import { notifyTaskComment } from "~/projects/lib/task-notifications.server";

export const ADD_TASK_COMMENT_TOOL = {
  name: "add_task_comment",
  description:
    "Append a comment to a project task. Allowed for anyone with project edit access (Core or staffed on the project — the same gate the web comment box uses) and, as self-service, the task's own assignees.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taskId: { type: "string", minLength: 1 },
      body: { type: "string", minLength: 1, maxLength: 10_000 },
    },
    required: ["taskId", "body"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

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

  // Match the web comment gate (requireProjectEditAccess): Core or anyone
  // staffed on the project. Plus the task's own assignees for self-service
  // (same extension as update_task_status). The tool used to be assignee-or-
  // Core, which was narrower than the web — a project member could move/rename
  // a task but not comment on it.
  const isAssignee = task.assignees.some((a) => a.userId === callerId);
  if (!isAssignee && !(await canEditProject(callerId, task.projectId))) {
    throw new AddTaskCommentError("Forbidden", 403);
  }

  const comment = await prisma.taskComment.create({
    data: { taskId: input.taskId, authorId: callerId, body },
    select: { id: true, createdAt: true },
  });

  void notifyTaskComment({ taskId: input.taskId, authorId: callerId, body }).catch(
    (err) =>
      console.error(`mcp add_task_comment: notify failed for ${input.taskId}`, err),
  );

  return {
    id: comment.id,
    taskId: input.taskId,
    createdAt: comment.createdAt.toISOString(),
  };
}
