// MCP `archive_done_tasks` — immediately archives all live Done/Cancelled tasks
// on a project (no idle-age threshold). Mirrors the POST
// /api/projects/:id/tasks/archive action. The weekly task-auto-archive job
// still uses the age-gated sweep for lab-wide cleanup; this tool is the
// on-demand board-level clear.
//
// Gate: canEditProject (Core or project member).

import { canEditProject } from "../access";
import { archiveTerminalTasks } from "~/jobs/task-auto-archive.server";
import { McpNotFoundError, McpForbiddenError } from "./errors";
import { prisma } from "~/lib/db";

export const ARCHIVE_DONE_TASKS_TOOL = {
  name: "archive_done_tasks",
  description:
    "Immediately archive every live Done/Cancelled task on a project (no idle-age threshold). Mirrors the board's 'Archive done tasks' button. Returns the count of tasks archived. Requires Core or project-member access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { projectId: string };

export async function runArchiveDoneTasks(callerId: string, input: Input) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) throw new McpNotFoundError("Project not found");

  if (!(await canEditProject(callerId, input.projectId))) {
    throw new McpForbiddenError();
  }

  const archived = await archiveTerminalTasks({
    now: new Date(),
    projectId: input.projectId,
  });

  return { archived };
}
