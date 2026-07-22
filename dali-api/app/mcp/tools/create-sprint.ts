// MCP `create_sprint` — Core or project member, mirrors api.projects.$id.sprints.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";

const SPRINT_STATUSES = ["Planned", "Active", "Closed"] as const;
type SprintStatus = (typeof SPRINT_STATUSES)[number];

export const CREATE_SPRINT_TOOL = {
  name: "create_sprint",
  description:
    "Create a sprint on a project. Requires Core or project-member access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1, maxLength: 200 },
      startsAt: { type: "string", description: "ISO timestamp." },
      endsAt: { type: "string", description: "ISO timestamp; must be after startsAt." },
      status: {
        type: "string",
        enum: SPRINT_STATUSES as unknown as string[],
        description: "Defaults to 'Planned'.",
      },
      epicId: {
        type: "string",
        description: "Optional epic this sprint belongs to. Empty string = standalone.",
      },
    },
    required: ["projectId", "name", "startsAt", "endsAt"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  projectId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status?: SprintStatus;
  epicId?: string;
};

export class CreateSprintError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CreateSprintError";
  }
}

export async function runCreateSprint(callerId: string, input: Input) {
  if (!(await canEditProject(callerId, input.projectId))) {
    throw new CreateSprintError("Forbidden", 403);
  }

  const name = input.name.trim();
  if (!name) throw new CreateSprintError("Name is required", 400);

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    throw new CreateSprintError("Invalid dates", 400);
  }
  if (endsAt <= startsAt) {
    throw new CreateSprintError("End date must be after start date", 400);
  }

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) throw new CreateSprintError("Project not found", 404);

  const sprint = await prisma.sprint.create({
    data: {
      projectId: input.projectId,
      name,
      startsAt,
      endsAt,
      status: input.status ?? "Planned",
      epicId: input.epicId && input.epicId !== "" ? input.epicId : null,
    },
    select: { id: true },
  });

  return { id: sprint.id };
}
