// MCP `get_project_overview` — read-only drill-down on a Project. Returns the
// project's identity fields, current-term roster, active sprint, current
// epic (if any), and task-status counts. Read access mirrors the project
// detail page: any authenticated DALI OS member can load it. Requires the
// `mcp:read` scope.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { fullName } from "~/lib/display";

export const GET_PROJECT_OVERVIEW_TOOL = {
  name: "get_project_overview",
  description:
    "Get a Project's overview: status, current-term roster, active sprint, current epic, task counts by status. Read-only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: {
        type: "string",
        minLength: 1,
        description: "Project.id, as returned by `list_my_projects`.",
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { projectId: string };

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} not found`);
    this.name = "ProjectNotFoundError";
  }
}

export async function runGetProjectOverview(input: Input) {
  const term = await currentTerm();
  const termId = term?.id ?? null;

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      imageUrl: true,
      repoUrls: true,
      overviewPageId: true,
      prdPageId: true,
      projectTerms: {
        select: { term: { select: { code: true, sortKey: true } } },
      },
      partners: {
        select: { partnerOrg: { select: { id: true, name: true } } },
      },
    },
  });
  if (!project) throw new ProjectNotFoundError(input.projectId);

  const [currentAssignments, activeSprint, openEpic, taskCounts] = await Promise.all([
    termId
      ? prisma.projectAssignment.findMany({
          where: { projectId: input.projectId, termId },
          select: {
            level: true,
            user: { select: { id: true, firstName: true, lastName: true } },
            domain: { select: { id: true, displayName: true } },
          },
        })
      : Promise.resolve([]),
    prisma.sprint.findFirst({
      where: { projectId: input.projectId, status: "Active" },
      orderBy: { startsAt: "desc" },
      select: { id: true, name: true, startsAt: true, endsAt: true },
    }),
    prisma.epic.findFirst({
      where: {
        projectId: input.projectId,
        status: { in: ["Open", "InProgress"] },
      },
      orderBy: { position: "asc" },
      select: { id: true, title: true, description: true, status: true },
    }),
    prisma.task.groupBy({
      by: ["status"],
      where: { projectId: input.projectId },
      _count: { _all: true },
    }),
  ]);

  const taskCountByStatus: Record<string, number> = {
    Todo: 0,
    InProgress: 0,
    InReview: 0,
    Done: 0,
    Cancelled: 0,
  };
  for (const row of taskCounts) taskCountByStatus[row.status] = row._count._all;

  const termCodes = project.projectTerms
    .map((pt) => pt.term)
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((t) => t.code);

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    imageUrl: project.imageUrl,
    repoUrls: project.repoUrls,
    overviewPageId: project.overviewPageId,
    prdPageId: project.prdPageId,
    termCodes,
    partners: project.partners.map((p) => ({
      id: p.partnerOrg.id,
      name: p.partnerOrg.name,
    })),
    currentTermRoster: currentAssignments.map((a) => ({
      userId: a.user.id,
      name: fullName(a.user),
      domain: a.domain.displayName,
      level: a.level,
    })),
    activeSprint: activeSprint
      ? {
          id: activeSprint.id,
          name: activeSprint.name,
          startsAt: activeSprint.startsAt.toISOString(),
          endsAt: activeSprint.endsAt.toISOString(),
        }
      : null,
    currentEpic: openEpic
      ? {
          id: openEpic.id,
          title: openEpic.title,
          description: openEpic.description,
          status: openEpic.status,
        }
      : null,
    taskCountByStatus,
  };
}
