// MCP `list_my_projects` — every Project the authenticated member is staffed
// on (any term, like `isProjectMember`), enriched with current-term context:
// their role on the project this term, the current sprint, open task count.
// Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { currentSprintBand } from "~/projects/lib/task-board";
import { DAY } from "~/projects/lib/timeline-days";

export const LIST_MY_PROJECTS_TOOL = {
  name: "list_my_projects",
  description:
    "List projects the authenticated DALI OS member is staffed on. Past-term assignments stay visible (matches in-app access). Each row includes the current-term role/domain (if assigned this term), the current sprint, and open task count.",
  inputSchema: {
    type: "object" as const,
    properties: {
      currentTermOnly: {
        type: "boolean",
        description:
          "If true, only return projects the member is staffed on for the current term (default false — past assignments included, matching project workspace access).",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { currentTermOnly?: boolean };

type MyProjectOut = {
  id: string;
  name: string;
  status: "Active" | "Paused" | "Archived";
  imageUrl: string | null;
  currentTermAssignment: {
    termCode: string;
    domainName: string;
    level: string;
  } | null;
  activeSprint: { label: string; endsAt: string } | null;
  openTaskCount: number;
};

export async function runListMyProjects(callerId: string, input: Input) {
  const term = await currentTerm();
  const termId = term?.id ?? null;

  const assignments = await prisma.projectAssignment.findMany({
    where: {
      userId: callerId,
      ...(input.currentTermOnly && termId ? { termId } : {}),
    },
    select: {
      projectId: true,
      termId: true,
      level: true,
      term: { select: { code: true } },
      domain: { select: { displayName: true } },
    },
  });

  const projectIds = Array.from(new Set(assignments.map((a) => a.projectId)));
  if (projectIds.length === 0) return { projects: [] as MyProjectOut[] };

  const [projects, openTaskCounts] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: {
        id: true,
        name: true,
        status: true,
        imageUrl: true,
        projectTerms: {
          select: {
            term: { select: { code: true, startDate: true, endDate: true, sortKey: true } },
          },
        },
      },
    }),
    prisma.task.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: projectIds },
        status: { notIn: ["Done", "Cancelled"] },
      },
      _count: { _all: true },
    }),
  ]);

  const openTaskByProject = new Map<string, number>();
  for (const row of openTaskCounts) openTaskByProject.set(row.projectId, row._count._all);

  // Pick the current-term assignment per project if one exists.
  const currentTermByProject = new Map<
    string,
    { termCode: string; domainName: string; level: string }
  >();
  if (termId) {
    for (const a of assignments) {
      if (a.termId === termId && !currentTermByProject.has(a.projectId)) {
        currentTermByProject.set(a.projectId, {
          termCode: a.term.code,
          domainName: a.domain.displayName,
          level: a.level,
        });
      }
    }
  }

  const now = new Date();
  const out: MyProjectOut[] = projects.map((p) => {
    const termSpans = p.projectTerms
      .map((pt) => pt.term)
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((t) => ({
        code: t.code,
        startsAt: t.startDate.toISOString(),
        endsAt: t.endDate.toISOString(),
      }));
    const band = currentSprintBand(termSpans, now);
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      imageUrl: p.imageUrl,
      currentTermAssignment: currentTermByProject.get(p.id) ?? null,
      activeSprint: band
        ? { label: band.label, endsAt: new Date(band.end + DAY).toISOString() }
        : null,
      openTaskCount: openTaskByProject.get(p.id) ?? 0,
    };
  });

  // Sort: current-term assignments first, then by name.
  out.sort((a, b) => {
    const aCurrent = a.currentTermAssignment ? 0 : 1;
    const bCurrent = b.currentTermAssignment ? 0 : 1;
    if (aCurrent !== bCurrent) return aCurrent - bCurrent;
    return a.name.localeCompare(b.name);
  });

  return { projects: out };
}
