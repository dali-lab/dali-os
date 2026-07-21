// MCP `get_task` — full drill-down on a single task: description, checklist,
// comment thread, assignees, GitHub mirror, linked project files. The list
// tools/resources intentionally return summary rows; this is the detail read.
// Read access is any authenticated member (mirrors get_project_overview).

import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";

export const GET_TASK_TOOL = {
  name: "get_task",
  description:
    "Get a task's full detail: description, checklist, comments, assignees, GitHub link, linked files. Read-only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taskId: {
        type: "string",
        minLength: 1,
        description: "Task.id, as returned by `list_my_tasks` or the board/backlog resources.",
      },
    },
    required: ["taskId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { taskId: string };

export class GetTaskError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "GetTaskError";
  }
}

export async function runGetTask(_callerId: string, input: Input) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      dueAt: true,
      archivedAt: true,
      checklist: true,
      githubRepo: true,
      githubIssueNumber: true,
      githubIssueUrl: true,
      createdAt: true,
      updatedAt: true,
      project: { select: { id: true, name: true } },
      sprint: { select: { id: true, name: true } },
      epic: { select: { id: true, title: true } },
      domain: { select: { name: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      assignees: {
        select: { user: { select: { id: true, firstName: true, lastName: true } } },
      },
      comments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      files: { select: { file: { select: { id: true, title: true } } } },
    },
  });
  if (!task) throw new GetTaskError(`Task ${input.taskId} not found`, 404);

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    archivedAt: task.archivedAt?.toISOString() ?? null,
    checklist: task.checklist ?? [],
    project: task.project,
    sprint: task.sprint,
    epic: task.epic,
    domainName: task.domain?.name ?? null,
    assignees: task.assignees.map((a) => ({ id: a.user.id, name: fullName(a.user) })),
    comments: task.comments.map((c) => ({
      id: c.id,
      author: { id: c.author.id, name: fullName(c.author) },
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
    github:
      task.githubRepo && task.githubIssueNumber
        ? { repo: task.githubRepo, issueNumber: task.githubIssueNumber, url: task.githubIssueUrl }
        : null,
    linkedFiles: task.files.map((f) => f.file),
    createdBy: { id: task.createdBy.id, name: fullName(task.createdBy) },
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
