// MCP `create_epic` — Core or project member. Mirrors api.projects.$id.epics.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";

export const CREATE_EPIC_TOOL = {
  name: "create_epic",
  description:
    "Create an epic (a bucket of related tasks, roughly a feature) on a project. Epics have no dates: on the timeline an epic spans the first through the last sprint holding one of its tasks. Requires Core or project-member access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 5000 },
    },
    required: ["projectId", "title"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { projectId: string; title: string; description?: string };

export class CreateEpicError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CreateEpicError";
  }
}

export async function runCreateEpic(callerId: string, input: Input) {
  if (!(await canEditProject(callerId, input.projectId))) {
    throw new CreateEpicError("Forbidden", 403);
  }
  const title = input.title.trim();
  if (!title) throw new CreateEpicError("Title is required", 400);

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
  const description = input.description?.trim() ?? "";
  const epic = await prisma.epic.create({
    data: {
      projectId: input.projectId,
      title,
      description: description === "" ? null : description,
      position: last ? last.position + 1 : 0,
    },
    select: { id: true },
  });
  return { id: epic.id };
}
