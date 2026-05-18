import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import type {
  Project,
  ProjectStatus,
  Sprint,
  Task,
  Epic,
  TaskStatus,
  ProjectAssignment,
} from "~/generated/prisma/client";

// Centralized data accessors for /projects routes. Loaders import from here
// so business-logic + N+1 avoidance lives in one place and the tests have a
// stable surface to mock.

// ─── Project directory ───────────────────────────────────────────────────────

export interface DirectoryProject {
  id: string;
  name: string;
  status: ProjectStatus;
  firstTermCode: string | null;
  pms: { id: string; firstName: string; lastName: string }[];
  partners: { id: string; name: string }[];
  memberCount: number;
}

interface DirectoryResult {
  mine: DirectoryProject[];
  active: DirectoryProject[];
  pastOrArchived: DirectoryProject[];
}

const PM_DOMAIN_CODE = "PM";

export async function listProjectsForUser(
  userId: string,
  termId: string | null,
  includePastAndArchived: boolean,
): Promise<DirectoryResult> {
  const where: { status?: { in: ProjectStatus[] } } = {};
  if (!includePastAndArchived) {
    where.status = { in: ["Active" as ProjectStatus] };
  }

  const projects = await prisma.project.findMany({
    where,
    include: {
      firstTerm: { select: { code: true } },
      partners: {
        include: { partnerOrg: { select: { id: true, name: true } } },
      },
      assignments: termId
        ? {
            where: { termId },
            include: {
              user: { select: { id: true, firstName: true, lastName: true } },
              domain: { select: { code: true } },
            },
          }
        : false,
    },
    orderBy: { createdAt: "desc" },
  });

  const mine: DirectoryProject[] = [];
  const active: DirectoryProject[] = [];
  const pastOrArchived: DirectoryProject[] = [];

  for (const p of projects) {
    const assignments = (p as unknown as {
      assignments?: {
        userId: string;
        user: { id: string; firstName: string; lastName: string };
        domain: { code: string };
      }[];
    }).assignments ?? [];
    const pms = assignments
      .filter((a) => a.domain.code === PM_DOMAIN_CODE)
      .map((a) => ({
        id: a.user.id,
        firstName: a.user.firstName,
        lastName: a.user.lastName,
      }));
    const partners = p.partners.map((pp) => ({
      id: pp.partnerOrg.id,
      name: pp.partnerOrg.name,
    }));
    const userIds = new Set(assignments.map((a) => a.userId));

    const row: DirectoryProject = {
      id: p.id,
      name: p.name,
      status: p.status,
      firstTermCode: p.firstTerm?.code ?? null,
      pms,
      partners,
      memberCount: userIds.size,
    };

    if (p.status !== "Active") {
      if (includePastAndArchived) pastOrArchived.push(row);
      continue;
    }

    if (userIds.has(userId)) {
      mine.push(row);
    } else {
      active.push(row);
    }
  }

  return { mine, active, pastOrArchived };
}

// ─── Project workspace (used by /projects/:id pages) ─────────────────────────

export interface WorkspaceData {
  project: Project & {
    partners: { partnerOrg: { id: string; name: string } }[];
    firstTerm: { id: string; code: string } | null;
    overviewPage: { id: string; contentDocId: string | null } | null;
  };
  pms: { id: string; firstName: string; lastName: string }[];
  memberCount: number;
  openSprintCount: number;
  currentTermId: string | null;
}

export async function getProjectWorkspace(
  projectId: string,
): Promise<WorkspaceData | null> {
  const term = await currentTerm();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      partners: {
        include: { partnerOrg: { select: { id: true, name: true } } },
      },
      firstTerm: { select: { id: true, code: true } },
      overviewPage: { select: { id: true, contentDocId: true } },
    },
  });
  if (!project) return null;

  const [assignments, openSprintCount] = await Promise.all([
    term
      ? prisma.projectAssignment.findMany({
          where: { projectId, termId: term.id },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
            domain: { select: { code: true } },
          },
        })
      : Promise.resolve([] as never[]),
    prisma.sprint.count({
      where: { projectId, status: { in: ["Planned", "Active"] } },
    }),
  ]);

  const pms = assignments
    .filter((a) => a.domain.code === PM_DOMAIN_CODE)
    .map((a) => ({
      id: a.user.id,
      firstName: a.user.firstName,
      lastName: a.user.lastName,
    }));
  const memberCount = new Set(assignments.map((a) => a.userId)).size;

  return {
    project,
    pms,
    memberCount,
    openSprintCount,
    currentTermId: term?.id ?? null,
  };
}

// ─── Roster (People tab) ─────────────────────────────────────────────────────

export interface RosterEntry {
  user: { id: string; firstName: string; lastName: string };
  domains: { code: string; displayName: string; level: string }[];
  mentors: { id: string; firstName: string; lastName: string; domainCode: string }[];
}

export async function getProjectRoster(
  projectId: string,
  termId: string,
): Promise<RosterEntry[]> {
  const [assignments, mentorPairs] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { projectId, termId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        domain: { select: { code: true, displayName: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mentorshipPair.findMany({
      where: { projectId, termId },
      include: {
        mentor: { select: { id: true, firstName: true, lastName: true } },
        domain: { select: { code: true } },
      },
    }),
  ]);

  const byUser = new Map<string, RosterEntry>();
  for (const a of assignments) {
    let entry = byUser.get(a.userId);
    if (!entry) {
      entry = {
        user: a.user,
        domains: [],
        mentors: [],
      };
      byUser.set(a.userId, entry);
    }
    entry.domains.push({
      code: a.domain.code,
      displayName: a.domain.displayName,
      level: a.level,
    });
  }
  for (const pair of mentorPairs) {
    const entry = byUser.get(pair.menteeUserId);
    if (entry) {
      entry.mentors.push({
        id: pair.mentor.id,
        firstName: pair.mentor.firstName,
        lastName: pair.mentor.lastName,
        domainCode: pair.domain.code,
      });
    }
  }
  return Array.from(byUser.values());
}

// ─── Sprints / Tasks / Epics ─────────────────────────────────────────────────

export interface TaskWithRelations {
  id: string;
  projectId: string;
  sprintId: string | null;
  epicId: string | null;
  title: string;
  status: TaskStatus;
  priority: Task["priority"];
  position: number;
  checklist: unknown;
  createdById: string;
  updatedAt: Date;
  assignees: { user: { id: string; firstName: string; lastName: string } }[];
  comments: number;
  description: string | null;
}

export async function listSprints(projectId: string): Promise<Sprint[]> {
  return prisma.sprint.findMany({
    where: { projectId },
    orderBy: [{ status: "asc" }, { startsAt: "asc" }],
  });
}

export async function listTasks(
  projectId: string,
  filter: { sprintId?: string | null; epicId?: string | null } = {},
): Promise<TaskWithRelations[]> {
  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      ...(filter.sprintId === null
        ? { sprintId: null }
        : filter.sprintId
          ? { sprintId: filter.sprintId }
          : {}),
      ...(filter.epicId === null
        ? { epicId: null }
        : filter.epicId
          ? { epicId: filter.epicId }
          : {}),
    },
    include: {
      assignees: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      _count: { select: { comments: true } },
    },
    orderBy: [{ status: "asc" }, { position: "asc" }],
  });
  return tasks.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    sprintId: t.sprintId,
    epicId: t.epicId,
    title: t.title,
    status: t.status,
    priority: t.priority,
    position: t.position,
    checklist: t.checklist,
    createdById: t.createdById,
    updatedAt: t.updatedAt,
    assignees: t.assignees.map((a) => ({ user: a.user })),
    comments: t._count.comments,
    description: null,
  }));
}

export async function listEpics(projectId: string): Promise<Epic[]> {
  return prisma.epic.findMany({
    where: { projectId },
    orderBy: [{ status: "asc" }, { position: "asc" }],
  });
}

// ─── Member assignment summary (used by directory + people tab term selector) ─

export async function getProjectAssignmentHistory(
  projectId: string,
): Promise<{
  termId: string;
  termCode: string;
  assignments: (ProjectAssignment & {
    user: { id: string; firstName: string; lastName: string };
    domain: { code: string };
  })[];
}[]> {
  const rows = await prisma.projectAssignment.findMany({
    where: { projectId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      term: { select: { id: true, code: true, sortKey: true } },
      domain: { select: { code: true } },
    },
  });
  const byTerm = new Map<
    string,
    {
      termId: string;
      termCode: string;
      sortKey: number;
      assignments: typeof rows;
    }
  >();
  for (const a of rows) {
    let bucket = byTerm.get(a.term.id);
    if (!bucket) {
      bucket = {
        termId: a.term.id,
        termCode: a.term.code,
        sortKey: a.term.sortKey,
        assignments: [],
      };
      byTerm.set(a.term.id, bucket);
    }
    bucket.assignments.push(a);
  }
  return Array.from(byTerm.values())
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((b) => ({
      termId: b.termId,
      termCode: b.termCode,
      assignments: b.assignments,
    }));
}
