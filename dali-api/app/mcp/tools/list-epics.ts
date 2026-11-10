// MCP `list_epics` — epics on a project with their user stories.

import { prisma } from "~/lib/db.server";
import { offsetPage, offsetWindow, pageProps, type PageArgs } from "../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

const EPIC_STATUSES = ["Backlog", "Open", "InProgress", "Done", "Cancelled"] as const;
type EpicStatus = (typeof EPIC_STATUSES)[number];

export const LIST_EPICS_TOOL = {
  name: "list_epics",
  description:
    "List a project's epics with their user stories. Ordered by position. Pass page.nextCursor as cursor to read the next page of epics until page.hasMore is false. Each epic carries all of its stories.",
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
      ...pageProps(PAGE_LIMITS),
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & { projectId: string; status?: EpicStatus[] };

export async function runListEpics(_callerId: string, input: Input) {
  const window = offsetWindow(input, PAGE_LIMITS);
  const where = {
    projectId: input.projectId,
    ...(input.status && input.status.length > 0 ? { status: { in: input.status } } : {}),
  };
  const [fetched, total] = await Promise.all([
    prisma.epic.findMany({
    where,
    orderBy: [{ position: "asc" }, { id: "asc" }],
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      startsAt: true,
      endsAt: true,
      stories: {
        orderBy: { position: "asc" },
        select: { id: true, title: true, notes: true, status: true },
      },
    },
    }),
    prisma.epic.count({ where }),
  ]);
  const { rows: epics, page } = offsetPage(fetched, window, total);

  return {
    page,
    epics: epics.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      status: e.status,
      startsAt: e.startsAt?.toISOString() ?? null,
      endsAt: e.endsAt?.toISOString() ?? null,
      stories: e.stories,
    })),
  };
}
