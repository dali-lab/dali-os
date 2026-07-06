// MCP `update_sprint` — Core-only. Mirrors api.sprints.$id POST. Omit a field
// to leave it unchanged. Use `set_sprint_status` for status (kept separate for
// symmetry with `update_task_status`).

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";

export const UPDATE_SPRINT_TOOL = {
  name: "update_sprint",
  description:
    "Edit sprint fields (name, dates, epic link). Core-only. Status changes go through `set_sprint_status`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      sprintId: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1, maxLength: 200 },
      startsAt: { type: "string", description: "ISO timestamp." },
      endsAt: { type: "string", description: "ISO timestamp." },
      epicId: { type: "string", description: "Empty string = unlink from epic." },
    },
    required: ["sprintId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  sprintId: string;
  name?: string;
  startsAt?: string;
  endsAt?: string;
  epicId?: string;
};

export class UpdateSprintError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "UpdateSprintError";
  }
}

export async function runUpdateSprint(callerId: string, input: Input) {
  if (!(await isCore(callerId))) {
    throw new UpdateSprintError("Forbidden", 403);
  }

  const sprint = await prisma.sprint.findUnique({
    where: { id: input.sprintId },
    select: { id: true, startsAt: true, endsAt: true },
  });
  if (!sprint) throw new UpdateSprintError("Sprint not found", 404);

  const data: {
    name?: string;
    startsAt?: Date;
    endsAt?: Date;
    epicId?: string | null;
  } = {};

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new UpdateSprintError("Name is required", 400);
    data.name = trimmed;
  }
  if (input.startsAt !== undefined) {
    const d = new Date(input.startsAt);
    if (!Number.isFinite(d.getTime())) {
      throw new UpdateSprintError("Invalid start date", 400);
    }
    data.startsAt = d;
  }
  if (input.endsAt !== undefined) {
    const d = new Date(input.endsAt);
    if (!Number.isFinite(d.getTime())) {
      throw new UpdateSprintError("Invalid end date", 400);
    }
    data.endsAt = d;
  }
  if (input.epicId !== undefined) {
    data.epicId = input.epicId === "" ? null : input.epicId;
  }

  const effStart = data.startsAt ?? sprint.startsAt;
  const effEnd = data.endsAt ?? sprint.endsAt;
  if (effEnd <= effStart) {
    throw new UpdateSprintError("End date must be after start date", 400);
  }

  if (Object.keys(data).length === 0) {
    return { ok: true, sprintId: input.sprintId, noop: true };
  }

  await prisma.sprint.update({ where: { id: input.sprintId }, data });
  return { ok: true, sprintId: input.sprintId };
}
