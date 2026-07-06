// MCP `list_epics` — epics on a project with their user stories.

import { prisma } from "~/lib/db";

const EPIC_STATUSES = ["Open", "InProgress", "Done", "Cancelled"] as const;
type EpicStatus = (typeof EPIC_STATUSES)[number];

export const LIST_EPICS_TOOL = {
  name: "list_epics",
  description:
    "List a project's epics with their user stories. Ordered by position.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      status: {
        type: "array",
        items: {
          type: "string",
          enum: EPIC_STATUSES as unknown as string[],
        },
        maxItems: EPIC_STATUSES.length,
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { projectId: string; status?: EpicStatus[] };

export async function runListEpics(_callerId: string, input: Input) {
  const epics = await prisma.epic.findMany({
    where: {
      projectId: input.projectId,
      ...(input.status && input.status.length > 0
        ? { status: { in: input.status } }
        : {}),
    },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      startsAt: true,
      endsAt: true,
      targetTermId: true,
      stories: {
        orderBy: { position: "asc" },
        select: { id: true, title: true, notes: true, status: true },
      },
    },
  });

  // Term has no inverse `targetTerm` relation declared on Epic in the schema,
  // so we resolve term codes in one follow-up query.
  const termIds = Array.from(
    new Set(epics.map((e) => e.targetTermId).filter((id): id is string => !!id)),
  );
  const terms = termIds.length
    ? await prisma.term.findMany({
        where: { id: { in: termIds } },
        select: { id: true, code: true },
      })
    : [];
  const termCodeById = new Map(terms.map((t) => [t.id, t.code]));

  return {
    epics: epics.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      status: e.status,
      startsAt: e.startsAt?.toISOString() ?? null,
      endsAt: e.endsAt?.toISOString() ?? null,
      targetTermId: e.targetTermId,
      targetTermCode: e.targetTermId ? termCodeById.get(e.targetTermId) ?? null : null,
      stories: e.stories,
    })),
  };
}
