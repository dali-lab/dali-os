// MCP `delete_epic` — Core or project member. Sprints/tasks pointing at the
// epic have their epicId nulled (mirrors api.epics.$id DELETE).

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";

export const DELETE_EPIC_TOOL = {
  name: "delete_epic",
  description:
    "Delete an epic. Sprints and tasks pointing at it have their epicId nulled (no cascade). Requires Core or project-member access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      epicId: { type: "string", minLength: 1 },
    },
    required: ["epicId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { epicId: string };

export class DeleteEpicError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "DeleteEpicError";
  }
}

export async function runDeleteEpic(callerId: string, input: Input) {
  const epic = await prisma.epic.findUnique({
    where: { id: input.epicId },
    select: { id: true, projectId: true },
  });
  if (!epic) throw new DeleteEpicError("Epic not found", 404);

  if (!(await canEditProject(callerId, epic.projectId))) {
    throw new DeleteEpicError("Forbidden", 403);
  }

  await prisma.$transaction([
    prisma.sprint.updateMany({
      where: { epicId: input.epicId },
      data: { epicId: null },
    }),
    prisma.task.updateMany({
      where: { epicId: input.epicId },
      data: { epicId: null },
    }),
    prisma.userStory.deleteMany({ where: { epicId: input.epicId } }),
    prisma.epic.delete({ where: { id: input.epicId } }),
  ]);

  return { ok: true, epicId: input.epicId };
}
