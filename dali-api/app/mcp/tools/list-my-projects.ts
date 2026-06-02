// MCP `list_my_projects` — every Project the authenticated member is staffed
// on (any term, like `isProjectMember`), enriched with current-term context:
// their role on the project this term, the active sprint, open task count.
// Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";

export const LIST_MY_PROJECTS_TOOL = {
  name: "list_my_projects",
  description:
    "List projects the authenticated DALI OS member is staffed on. Past-term assignments stay visible (matches in-app access). Each row includes the current-term role/domain (if assigned this term), the active sprint, and open task count.",
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
  activeSprint: { id: string; name: string; endsAt: string } | null;
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

  const [projects, activeSprints, openTaskCounts] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true, status: true, imageUrl: true },
    }),
    prisma.sprint.findMany({
      where: { projectId: { in: projectIds }, status: "Active" },
      orderBy: { startsAt: "desc" },
      select: { id: true, projectId: true, name: true, endsAt: true },
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

  // First active sprint per project (groupBy not directly applicable here).
  const activeSprintByProject = new Map<string, { id: string; name: string; endsAt: Date }>();
  for (const s of activeSprints) {
    if (!activeSprintByProject.has(s.projectId)) {
      activeSprintByProject.set(s.projectId, { id: s.id, name: s.name, endsAt: s.endsAt });
    }
  }
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

  const out: MyProjectOut[] = projects.map((p) => {
    const sprint = activeSprintByProject.get(p.id);
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      imageUrl: p.imageUrl,
      currentTermAssignment: currentTermByProject.get(p.id) ?? null,
      activeSprint: sprint
        ? { id: sprint.id, name: sprint.name, endsAt: sprint.endsAt.toISOString() }
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
