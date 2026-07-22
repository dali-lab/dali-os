// MCP `set_sprint_status` — move a sprint between Planned/Active/Closed.
// Core or project member. Wrapping it as a separate tool (rather than a status
// field on `update_sprint`) makes the lifecycle transition explicit in tool
// calls.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";

const SPRINT_STATUSES = ["Planned", "Active", "Closed"] as const;
type SprintStatus = (typeof SPRINT_STATUSES)[number];

export const SET_SPRINT_STATUS_TOOL = {
  name: "set_sprint_status",
  description:
    "Set a sprint's lifecycle status (Planned, Active, Closed). Requires Core or project-member access. Note: parallel sprints can be Active at the same time.",
  inputSchema: {
    type: "object" as const,
    properties: {
      sprintId: { type: "string", minLength: 1 },
      status: {
        type: "string",
        enum: SPRINT_STATUSES as unknown as string[],
      },
    },
    required: ["sprintId", "status"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { sprintId: string; status: SprintStatus };

export class SetSprintStatusError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "SetSprintStatusError";
  }
}

export async function runSetSprintStatus(callerId: string, input: Input) {
  const sprint = await prisma.sprint.findUnique({
    where: { id: input.sprintId },
    select: { id: true, projectId: true, status: true },
  });
  if (!sprint) throw new SetSprintStatusError("Sprint not found", 404);

  if (!(await canEditProject(callerId, sprint.projectId))) {
    throw new SetSprintStatusError("Forbidden", 403);
  }

  await prisma.sprint.update({
    where: { id: input.sprintId },
    data: { status: input.status },
  });

  return {
    ok: true,
    sprintId: input.sprintId,
    previousStatus: sprint.status,
    newStatus: input.status,
  };
}
