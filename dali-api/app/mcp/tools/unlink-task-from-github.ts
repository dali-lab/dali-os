// MCP `unlink_task_from_github` — clear the GitHub mirror fields on a task.
// Leaves the GH issue itself alone; just severs the dalios↔GH connection so
// future edits stop syncing. Core or project member.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";

export const UNLINK_TASK_FROM_GITHUB_TOOL = {
  name: "unlink_task_from_github",
  description:
    "Clear a task's GitHub issue link. The GitHub issue is left untouched on GH — this only severs dalios's mirror tracking. Requires Core or project-member access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taskId: { type: "string", minLength: 1 },
    },
    required: ["taskId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { taskId: string };

export class UnlinkTaskFromGithubError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "UnlinkTaskFromGithubError";
  }
}

export async function runUnlinkTaskFromGithub(callerId: string, input: Input) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      projectId: true,
      githubIssueNumber: true,
      githubRepo: true,
      githubIssueUrl: true,
    },
  });
  if (!task) throw new UnlinkTaskFromGithubError("Task not found", 404);

  if (!(await canEditProject(callerId, task.projectId))) {
    throw new UnlinkTaskFromGithubError("Forbidden", 403);
  }
  if (task.githubIssueNumber === null) {
    return { ok: true, taskId: input.taskId, noop: true };
  }

  await prisma.task.update({
    where: { id: input.taskId },
    data: { githubRepo: null, githubIssueNumber: null, githubIssueUrl: null },
  });

  return {
    ok: true,
    taskId: input.taskId,
    previousRepo: task.githubRepo,
    previousIssueNumber: task.githubIssueNumber,
  };
}
