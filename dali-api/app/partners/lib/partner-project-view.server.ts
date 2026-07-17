import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { fullName } from "~/lib/display";

export type PartnerProjectSprint = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "Active" | "Closed";
  done: number;
  open: number;
};

export type PartnerProjectEpic = {
  id: string;
  title: string;
  status: "Backlog" | "Open" | "InProgress" | "Done" | "Cancelled";
  startsAt: string | null;
  endsAt: string | null;
  sprints: PartnerProjectSprint[];
};

export type PartnerProjectViewData = {
  project: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    terms: string[];
  };
  partnerSince: string | null;
  currentTermCode: string | null;
  team: { name: string; domains: string[] }[];
  // Current-work hierarchy: epic cards first, with their in-flight sprints
  // nested under each. Sprints with no epic sit in ungroupedSprints.
  epics: PartnerProjectEpic[];
  ungroupedSprints: PartnerProjectSprint[];
  nextSprint: { name: string; startsAt: string; endsAt: string } | null;
  recentlyDone: {
    id: string;
    title: string;
    doneAt: string;
    domain: string | null;
  }[];
  sharedPages: {
    id: string;
    title: string;
    iconEmoji: string | null;
    updatedAt: string;
  }[];
};

// The whole partner read-surface for a project: current epics/sprints, roster,
// recently-closed tasks, and partner-shared docs. Shared by the real partner
// portal (partner.projects.$id.tsx, scoped to the signed-in partner's org)
// and the in-app preview any signed-in member can open from the project page
// (projects.$id.partner-view.tsx, which has no partnerOrgId of its own —
// pass null and partnerSince comes back null).
export async function loadPartnerProjectView(
  projectId: string,
  partnerOrgId: string | null,
): Promise<PartnerProjectViewData | null> {
  // Every select below is deliberately minimal — this is the whole partner
  // read-surface for a project. No assignees on tasks, no levels on the
  // roster, nothing from unshared pages.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      imageUrl: true,
      projectTerms: {
        select: { term: { select: { code: true, sortKey: true } } },
      },
    },
  });
  if (!project) return null;

  const current = await currentTerm();

  const [
    partnership,
    assignments,
    activeSprints,
    plannedSprint,
    lastClosedSprint,
    recentlyDone,
    sharedPages,
  ] = await Promise.all([
    partnerOrgId
      ? prisma.projectPartner.findFirst({
          where: { projectId: project.id, partnerOrgId },
          select: { startedAt: true },
        })
      : Promise.resolve(null),
    current
      ? prisma.projectAssignment.findMany({
          where: { projectId: project.id, termId: current.id },
          select: {
            user: { select: { id: true, firstName: true, lastName: true } },
            domain: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    prisma.sprint.findMany({
      where: { projectId: project.id, status: "Active" },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        name: true,
        startsAt: true,
        endsAt: true,
        epicId: true,
        epic: {
          select: {
            id: true,
            title: true,
            status: true,
            startsAt: true,
            endsAt: true,
            position: true,
          },
        },
      },
    }),
    prisma.sprint.findFirst({
      where: { projectId: project.id, status: "Planned" },
      orderBy: { startsAt: "asc" },
      select: { name: true, startsAt: true, endsAt: true },
    }),
    prisma.sprint.findFirst({
      where: { projectId: project.id, status: "Closed" },
      orderBy: { endsAt: "desc" },
      select: {
        id: true,
        name: true,
        startsAt: true,
        endsAt: true,
        epicId: true,
        epic: {
          select: {
            id: true,
            title: true,
            status: true,
            startsAt: true,
            endsAt: true,
            position: true,
          },
        },
      },
    }),
    prisma.task.findMany({
      where: { projectId: project.id, status: "Done" },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        domain: { select: { displayName: true } },
      },
    }),
    prisma.page.findMany({
      where: {
        workspaceType: "Project",
        workspaceId: project.id,
        archivedAt: null,
        partnerVisible: true,
      },
      orderBy: { position: "asc" },
      select: { id: true, title: true, iconEmoji: true, updatedAt: true },
    }),
  ]);

  // Progress counts for the sprints we'll show (active, or the last closed
  // one as a fallback so the page never reads empty between sprints).
  const summarySprints = activeSprints.length
    ? activeSprints.map((s) => ({ ...s, status: "Active" as const }))
    : lastClosedSprint
      ? [{ ...lastClosedSprint, status: "Closed" as const }]
      : [];
  const counts = summarySprints.length
    ? await prisma.task.groupBy({
        by: ["sprintId", "status"],
        where: {
          projectId: project.id,
          sprintId: { in: summarySprints.map((s) => s.id) },
        },
        _count: { _all: true },
      })
    : [];

  function toSprintCard(
    s: (typeof summarySprints)[number],
  ): PartnerProjectSprint {
    const mine = counts.filter((c) => c.sprintId === s.id);
    const total = mine.reduce((sum, c) => sum + c._count._all, 0);
    const done = mine
      .filter((c) => c.status === "Done")
      .reduce((sum, c) => sum + c._count._all, 0);
    const cancelled = mine
      .filter((c) => c.status === "Cancelled")
      .reduce((sum, c) => sum + c._count._all, 0);
    return {
      id: s.id,
      name: s.name,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      status: s.status,
      done,
      open: Math.max(0, total - cancelled - done),
    };
  }

  // Group under epics (ordered by epic.position). Sprints with no epic stay
  // in ungroupedSprints so they still surface on the partner view.
  const epicMap = new Map<
    string,
    PartnerProjectEpic & { position: number }
  >();
  const ungroupedSprints: PartnerProjectSprint[] = [];
  for (const s of summarySprints) {
    const card = toSprintCard(s);
    if (!s.epic) {
      ungroupedSprints.push(card);
      continue;
    }
    const existing = epicMap.get(s.epic.id);
    if (existing) {
      existing.sprints.push(card);
    } else {
      epicMap.set(s.epic.id, {
        id: s.epic.id,
        title: s.epic.title,
        status: s.epic.status,
        startsAt: s.epic.startsAt?.toISOString() ?? null,
        endsAt: s.epic.endsAt?.toISOString() ?? null,
        sprints: [card],
        position: s.epic.position,
      });
    }
  }
  const epics: PartnerProjectEpic[] = [...epicMap.values()]
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
    .map(({ position: _position, ...epic }) => epic);

  // Dedupe the roster: one row per person, domains joined.
  const roster = new Map<string, { name: string; domains: Set<string> }>();
  for (const a of assignments) {
    const entry = roster.get(a.user.id) ?? {
      name: fullName(a.user),
      domains: new Set<string>(),
    };
    entry.domains.add(a.domain.name);
    roster.set(a.user.id, entry);
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      imageUrl: await resolvePhotoUrl(project.imageUrl),
      terms: [...project.projectTerms]
        .sort((a, b) => a.term.sortKey - b.term.sortKey)
        .map((t) => t.term.code),
    },
    partnerSince: partnership?.startedAt?.toISOString() ?? null,
    currentTermCode: current?.code ?? null,
    team: [...roster.values()].map((r) => ({
      name: r.name,
      domains: [...r.domains].sort(),
    })),
    epics,
    ungroupedSprints,
    nextSprint: plannedSprint
      ? {
          name: plannedSprint.name,
          startsAt: plannedSprint.startsAt.toISOString(),
          endsAt: plannedSprint.endsAt.toISOString(),
        }
      : null,
    recentlyDone: recentlyDone.map((t) => ({
      id: t.id,
      title: t.title,
      doneAt: t.updatedAt.toISOString(),
      domain: t.domain?.displayName ?? null,
    })),
    sharedPages: sharedPages.map((p) => ({
      id: p.id,
      title: p.title,
      iconEmoji: p.iconEmoji,
      updatedAt: p.updatedAt.toISOString(),
    })),
  };
}
