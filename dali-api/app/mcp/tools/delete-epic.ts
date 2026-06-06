// MCP `delete_epic` — Core-only. Sprints/tasks pointing at the epic have
// their epicId nulled (mirrors api.epics.$id DELETE).

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";

export const DELETE_EPIC_TOOL = {
  name: "delete_epic",
  description:
    "Delete an epic. Sprints and tasks pointing at it have their epicId nulled (no cascade). Core-only.",
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
  if (!(await isCore(callerId))) {
    throw new DeleteEpicError("Forbidden", 403);
  }

  const epic = await prisma.epic.findUnique({
    where: { id: input.epicId },
    select: { id: true },
  });
  if (!epic) throw new DeleteEpicError("Epic not found", 404);

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
