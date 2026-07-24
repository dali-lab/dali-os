// MCP `update_epic` — Core or project member. Mirrors api.epics.$id POST.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";

const EPIC_STATUSES = ["Backlog", "Open", "InProgress", "Done", "Cancelled"] as const;
type EpicStatus = (typeof EPIC_STATUSES)[number];

export const UPDATE_EPIC_TOOL = {
  name: "update_epic",
  description:
    "Edit an epic's fields (title, description, status, dates, target term). Requires Core or project-member access. Empty string clears nullable fields.",
  inputSchema: {
    type: "object" as const,
    properties: {
      epicId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 5000 },
      status: {
        type: "string",
        enum: EPIC_STATUSES as unknown as string[],
      },
      startsAt: { type: "string", description: "Empty string clears." },
      endsAt: { type: "string", description: "Empty string clears." },
      targetTermId: { type: "string", description: "Empty string clears." },
    },
    required: ["epicId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  epicId: string;
  title?: string;
  description?: string;
  status?: EpicStatus;
  startsAt?: string;
  endsAt?: string;
  targetTermId?: string;
};

export class UpdateEpicError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "UpdateEpicError";
  }
}

export async function runUpdateEpic(callerId: string, input: Input) {
  const epic = await prisma.epic.findUnique({
    where: { id: input.epicId },
    select: { id: true, projectId: true, startsAt: true, endsAt: true },
  });
  if (!epic) throw new UpdateEpicError("Epic not found", 404);

  if (!(await canEditProject(callerId, epic.projectId))) {
    throw new UpdateEpicError("Forbidden", 403);
  }

  const data: {
    title?: string;
    description?: string | null;
    status?: EpicStatus;
    startsAt?: Date | null;
    endsAt?: Date | null;
    targetTermId?: string | null;
  } = {};

  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (!trimmed) throw new UpdateEpicError("Title is required", 400);
    data.title = trimmed;
  }
  if (input.description !== undefined) {
    const trimmed = input.description.trim();
    data.description = trimmed === "" ? null : trimmed;
  }
  if (input.status !== undefined) data.status = input.status;
  if (input.startsAt !== undefined) {
    if (input.startsAt === "") data.startsAt = null;
    else {
      const d = new Date(input.startsAt);
      if (!Number.isFinite(d.getTime())) {
        throw new UpdateEpicError("Invalid start date", 400);
      }
      data.startsAt = d;
    }
  }
  if (input.endsAt !== undefined) {
    if (input.endsAt === "") data.endsAt = null;
    else {
      const d = new Date(input.endsAt);
      if (!Number.isFinite(d.getTime())) {
        throw new UpdateEpicError("Invalid end date", 400);
      }
      data.endsAt = d;
    }
  }
  if (input.targetTermId !== undefined) {
    data.targetTermId = input.targetTermId === "" ? null : input.targetTermId;
  }

  const effStart = data.startsAt !== undefined ? data.startsAt : epic.startsAt;
  const effEnd = data.endsAt !== undefined ? data.endsAt : epic.endsAt;
  if (effStart && effEnd && effEnd <= effStart) {
    throw new UpdateEpicError("End date must be after start date", 400);
  }

  if (Object.keys(data).length === 0) {
    return { ok: true, epicId: input.epicId, noop: true };
  }

  await prisma.epic.update({ where: { id: input.epicId }, data });
  return { ok: true, epicId: input.epicId };
}
