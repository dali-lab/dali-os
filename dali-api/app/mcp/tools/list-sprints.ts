// MCP `list_sprints` — sprints on a project. Any authenticated member can read.

import { prisma } from "~/lib/db";

const SPRINT_STATUSES = ["Planned", "Active", "Closed"] as const;
type SprintStatus = (typeof SPRINT_STATUSES)[number];

export const LIST_SPRINTS_TOOL = {
  name: "list_sprints",
  description:
    "List a project's sprints, newest first. Optionally filter by status.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      status: {
        type: "array",
        items: {
          type: "string",
          enum: SPRINT_STATUSES as unknown as string[],
        },
        maxItems: SPRINT_STATUSES.length,
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { projectId: string; status?: SprintStatus[] };

export async function runListSprints(_callerId: string, input: Input) {
  const sprints = await prisma.sprint.findMany({
    where: {
      projectId: input.projectId,
      ...(input.status && input.status.length > 0
        ? { status: { in: input.status } }
        : {}),
    },
    orderBy: { startsAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      startsAt: true,
      endsAt: true,
      epicId: true,
      epic: { select: { title: true } },
    },
  });

  return {
    sprints: sprints.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      epicId: s.epicId,
      epicTitle: s.epic?.title ?? null,
    })),
  };
}
