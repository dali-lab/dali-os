// MCP `delete_sprint` — hard-delete; tasks in the sprint fall back to backlog
// (sprintId nulled). Core or project member. Mirrors api.sprints.$id DELETE.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";

export const DELETE_SPRINT_TOOL = {
  name: "delete_sprint",
  description:
    "Delete a sprint. Tasks pointing at the sprint fall back to backlog (sprintId nulled). Requires Core or project-member access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      sprintId: { type: "string", minLength: 1 },
    },
    required: ["sprintId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { sprintId: string };

export class DeleteSprintError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "DeleteSprintError";
  }
}

export async function runDeleteSprint(callerId: string, input: Input) {
  const sprint = await prisma.sprint.findUnique({
    where: { id: input.sprintId },
    select: { id: true, projectId: true },
  });
  if (!sprint) throw new DeleteSprintError("Sprint not found", 404);

  if (!(await canEditProject(callerId, sprint.projectId))) {
    throw new DeleteSprintError("Forbidden", 403);
  }

  await prisma.$transaction([
    prisma.task.updateMany({
      where: { sprintId: input.sprintId },
      data: { sprintId: null },
    }),
    prisma.sprint.delete({ where: { id: input.sprintId } }),
  ]);

  return { ok: true, sprintId: input.sprintId };
}
