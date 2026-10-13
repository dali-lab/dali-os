// MCP `list_epics` — epics on a project with their user stories, derived
// status, task progress and sprint span.

import { prisma } from "~/lib/db";
import { deriveEpicStatus, epicSprintSpan, type EpicDerivedStatus } from "~/projects/lib/sprints";

const EPIC_STATUSES: EpicDerivedStatus[] = ["NotStarted", "InProgress", "Done", "Cancelled"];

export const LIST_EPICS_TOOL = {
  name: "list_epics",
  description:
    "List a project's epics with their user stories. Each epic's status is derived from its tasks (Cancelled is set by hand), and its span runs from the first to the last sprint holding one of its tasks (null = unscheduled). Ordered by position.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      status: {
        type: "array",
        items: { type: "string", enum: EPIC_STATUSES },
        maxItems: EPIC_STATUSES.length,
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { projectId: string; status?: EpicDerivedStatus[] };

export async function runListEpics(_callerId: string, input: Input) {
  const epics = await prisma.epic.findMany({
    where: { projectId: input.projectId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      description: true,
      cancelledAt: true,
      stories: {
        orderBy: { position: "asc" },
        select: { id: true, title: true, notes: true, status: true },
      },
      tasks: {
        where: { archivedAt: null },
        select: { status: true, sprint: { select: { startsOn: true, endsOn: true } } },
      },
    },
  });

  const out = epics.map((e) => {
    const status = deriveEpicStatus(e, e.tasks.map((t) => t.status));
    const span = epicSprintSpan(
      e.tasks.map((t) =>
        t.sprint ? { startsOn: t.sprint.startsOn.getTime(), endsOn: t.sprint.endsOn.getTime() } : null,
      ),
    );
    const counted = e.tasks.filter((t) => t.status !== "Cancelled");
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      status,
      startsOn: span ? new Date(span.startsOn).toISOString() : null,
      endsOn: span ? new Date(span.endsOn).toISOString() : null,
      tasks: { done: counted.filter((t) => t.status === "Done").length, total: counted.length },
      stories: e.stories,
    };
  });
  const want = input.status && input.status.length > 0 ? new Set(input.status) : null;
  return { epics: want ? out.filter((e) => want.has(e.status)) : out };
}
