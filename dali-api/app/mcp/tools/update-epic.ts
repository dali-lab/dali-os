// MCP `update_epic` — Core or project member. Mirrors api.epics.$id POST.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";

export const UPDATE_EPIC_TOOL = {
  name: "update_epic",
  description:
    "Edit an epic (title, description) or cancel/reopen it. An epic's status otherwise follows its tasks and its timeline span follows their sprints. Requires Core or project-member access. Empty description clears it.",
  inputSchema: {
    type: "object" as const,
    properties: {
      epicId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 5000 },
      cancelled: { type: "boolean", description: "true cancels the epic; false reopens it." },
    },
    required: ["epicId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { epicId: string; title?: string; description?: string; cancelled?: boolean };

export class UpdateEpicError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "UpdateEpicError";
  }
}

export async function runUpdateEpic(callerId: string, input: Input) {
  const epic = await prisma.epic.findUnique({
    where: { id: input.epicId },
    select: { id: true, projectId: true, cancelledAt: true },
  });
  if (!epic) throw new UpdateEpicError("Epic not found", 404);
  if (!(await canEditProject(callerId, epic.projectId))) {
    throw new UpdateEpicError("Forbidden", 403);
  }

  const data: { title?: string; description?: string | null; cancelledAt?: Date | null } = {};
  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (!trimmed) throw new UpdateEpicError("Title is required", 400);
    data.title = trimmed;
  }
  if (input.description !== undefined) {
    const trimmed = input.description.trim();
    data.description = trimmed === "" ? null : trimmed;
  }
  if (input.cancelled !== undefined && input.cancelled !== (epic.cancelledAt !== null)) {
    data.cancelledAt = input.cancelled ? new Date() : null;
  }
  if (Object.keys(data).length === 0) return { ok: true, epicId: input.epicId, noop: true };

  await prisma.epic.update({ where: { id: input.epicId }, data });
  return { ok: true, epicId: input.epicId };
}
