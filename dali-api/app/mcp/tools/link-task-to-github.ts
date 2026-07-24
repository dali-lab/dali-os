// MCP `link_task_to_github` — create a GitHub issue mirror for a task that
// isn't yet mirrored. Wraps createIssueForTask. Core or project member.
// (v1: link = create-new-issue. Linking to an existing issue would require
// new infrastructure; not in scope.)

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";
import {
  createIssueForTask,
  normalizeRepo,
} from "~/projects/lib/github-task-sync";

export const LINK_TASK_TO_GITHUB_TOOL = {
  name: "link_task_to_github",
  description:
    "Create a GitHub issue mirror for a task. `repo` must be one of the project's repoUrls. Requires Core or project-member access. Returns immediately; the GH write is fire-and-forget.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taskId: { type: "string", minLength: 1 },
      repo: {
        type: "string",
        minLength: 1,
        description: "owner/repo (or a github.com URL). Must appear in the project's repoUrls.",
      },
    },
    required: ["taskId", "repo"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { taskId: string; repo: string };

export class LinkTaskToGithubError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "LinkTaskToGithubError";
  }
}

export async function runLinkTaskToGithub(callerId: string, input: Input) {
  const normalized = normalizeRepo(input.repo);
  if (!normalized) throw new LinkTaskToGithubError("Invalid repo", 400);

  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      projectId: true,
      githubIssueNumber: true,
      project: { select: { repoUrls: true } },
    },
  });
  if (!task) throw new LinkTaskToGithubError("Task not found", 404);

  if (!(await canEditProject(callerId, task.projectId))) {
    throw new LinkTaskToGithubError("Forbidden", 403);
  }

  if (task.githubIssueNumber !== null) {
    throw new LinkTaskToGithubError("Task is already linked to a GitHub issue", 400);
  }

  const allowed = task.project.repoUrls
    .map(normalizeRepo)
    .filter((r): r is string => !!r);
  if (!allowed.includes(normalized)) {
    throw new LinkTaskToGithubError(
      "Repo is not one of the project's repoUrls",
      400,
    );
  }

  void createIssueForTask(input.taskId, normalized).catch((err) =>
    console.error(`mcp link_task_to_github: failed for ${input.taskId}`, err),
  );

  return { ok: true, taskId: input.taskId, repo: normalized, queued: true };
}
