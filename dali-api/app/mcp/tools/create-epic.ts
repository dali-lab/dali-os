// MCP `create_epic` — Core-only. Mirrors api.projects.$id.epics.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";

const EPIC_STATUSES = ["Open", "InProgress", "Done", "Cancelled"] as const;
type EpicStatus = (typeof EPIC_STATUSES)[number];

export const CREATE_EPIC_TOOL = {
  name: "create_epic",
  description: "Create an epic on a project. Core-only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 5000 },
      status: {
        type: "string",
        enum: EPIC_STATUSES as unknown as string[],
        description: "Defaults to 'Open'.",
      },
      startsAt: { type: "string", description: "Optional ISO timestamp." },
      endsAt: { type: "string", description: "Optional ISO timestamp." },
      targetTermId: {
        type: "string",
        description: "Optional Term.id; empty string = unset.",
      },
    },
    required: ["projectId", "title"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  projectId: string;
  title: string;
  description?: string;
  status?: EpicStatus;
  startsAt?: string;
  endsAt?: string;
  targetTermId?: string;
};

export class CreateEpicError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CreateEpicError";
  }
}

function parseDate(v: string | undefined): Date | null | "invalid" {
  if (v === undefined || v === "") return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : "invalid";
}

export async function runCreateEpic(callerId: string, input: Input) {
  if (!(await isCore(callerId))) {
    throw new CreateEpicError("Forbidden", 403);
  }

  const title = input.title.trim();
  if (!title) throw new CreateEpicError("Title is required", 400);

  const startsAt = parseDate(input.startsAt);
  const endsAt = parseDate(input.endsAt);
  if (startsAt === "invalid" || endsAt === "invalid") {
    throw new CreateEpicError("Invalid dates", 400);
  }
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new CreateEpicError("End date must be after start date", 400);
  }

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) throw new CreateEpicError("Project not found", 404);

  const last = await prisma.epic.findFirst({
    where: { projectId: input.projectId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const description = input.description?.trim() ?? "";
  const epic = await prisma.epic.create({
    data: {
      projectId: input.projectId,
      title,
      description: description === "" ? null : description,
      status: input.status ?? "Open",
      position,
      startsAt,
      endsAt,
      targetTermId:
        input.targetTermId && input.targetTermId !== "" ? input.targetTermId : null,
    },
    select: { id: true },
  });

  return { id: epic.id };
}
