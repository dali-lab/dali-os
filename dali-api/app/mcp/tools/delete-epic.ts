// MCP `delete_epic` — Core or project member. Mirrors api.epics.$id DELETE.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";
import { deleteEpic } from "~/projects/lib/sprints.server";

export const DELETE_EPIC_TOOL = {
  name: "delete_epic",
  description:
    "Delete an epic. Its tasks move to the project's General epic and its user stories are deleted. Requires Core or project-member access.",
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

  if ((await deleteEpic(input.epicId, epic.projectId)) === "general-in-use") {
    throw new DeleteEpicError("Move General's tasks elsewhere before deleting it", 409);
  }

  return { ok: true, epicId: input.epicId };
}
