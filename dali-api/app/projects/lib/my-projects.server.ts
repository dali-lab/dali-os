import { prisma } from "~/lib/db.server";
import { currentTerm } from "~/lib/roles";
import { currentSprintBand } from "~/projects/lib/task-board";
import { DAY } from "~/projects/lib/timeline-days";

export type ListMyProjectsInput = { currentTermOnly?: boolean };

export type MyProject = {
  id: string;
  name: string;
  status: "Active" | "Paused" | "Archived";
  imageUrl: string | null;
  terms: string[];
  currentTermAssignment: {
    termCode: string;
    domainName: string;
    level: string;
  } | null;
  activeSprint: { label: string; endsAt: string } | null;
  openTaskCount: number;
};

export async function listMyProjects(callerId: string, input: ListMyProjectsInput) {
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
  if (projectIds.length === 0) return { projects: [] as MyProject[] };

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
  const out: MyProject[] = projects.map((p) => {
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
      terms: termSpans.map((t) => t.code),
      currentTermAssignment: currentTermByProject.get(p.id) ?? null,
      activeSprint: band
        ? { label: band.label, endsAt: new Date(band.end + DAY).toISOString() }
        : null,
      openTaskCount: openTaskByProject.get(p.id) ?? 0,
    };
  });

  out.sort((a, b) => {
    const aCurrent = a.currentTermAssignment ? 0 : 1;
    const bCurrent = b.currentTermAssignment ? 0 : 1;
    if (aCurrent !== bCurrent) return aCurrent - bCurrent;
    return a.name.localeCompare(b.name);
  });

  return { projects: out };
}
