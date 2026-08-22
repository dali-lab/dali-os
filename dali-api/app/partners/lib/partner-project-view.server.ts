import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { getDownloadUrl } from "~/lib/s3";
import { fullName } from "~/lib/display";

// Which of the account's orgs holds the active partnership with this project —
// used to surface the correct partnerSince date. Lives here (a .server helper)
// so the rendering route never imports ~/lib/db directly (see the client-bundle
// leak guard). Returns null when none matches; access is checked separately.
export async function resolvePartnerProjectOrgId(
  projectId: string,
  orgIds: string[],
): Promise<string | null> {
  if (orgIds.length === 0) return null;
  const link = await prisma.projectPartner.findFirst({
    where: { projectId, partnerOrgId: { in: orgIds } },
    select: { partnerOrgId: true },
    orderBy: { startedAt: "asc" },
  });
  return link?.partnerOrgId ?? null;
}

// The three time states every work item collapses to, so the UI can speak one
// visual language: past (teal/settled), current (coral/live), planned (dashed).
export type PartnerWorkState = "past" | "current" | "planned";

export type PartnerProjectSprint = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "Active" | "Closed" | "Planned";
  done: number;
  open: number;
};

export type PartnerProjectStory = {
  id: string;
  title: string;
  status: "Todo" | "InProgress" | "Done";
  successMetric: string | null;
  acceptanceCriteria: string | null;
  category: string | null;
  priority: "Must" | "Should" | "Could" | "Wont" | null;
};

export type PartnerProjectEpic = {
  id: string;
  title: string;
  status: "Backlog" | "Open" | "InProgress" | "Done" | "Cancelled";
  startsAt: string | null;
  endsAt: string | null;
  // Scope (what we're building) and schedule (when) — the two parallel
  // children of an epic. Sprints carry every status so the epic reads as a
  // mini past→current→planned timeline.
  stories: PartnerProjectStory[];
  sprints: PartnerProjectSprint[];
};

export type PartnerProjectViewData = {
  project: {
    id: string;
    name: string;
    iconEmoji: string | null;
    description: string | null;
    imageUrl: string | null;
    terms: string[];
  };
  partnerSince: string | null;
  currentTermCode: string | null;
  team: { name: string; domains: string[]; photoUrl: string | null }[];
  // Aggregate live progress across the in-flight sprint(s) — the hero readout.
  // Null when nothing is active (between sprints / not yet started).
  momentum: {
    label: string;
    done: number;
    total: number;
    endsAt: string;
    daysLeft: number;
  } | null;
  // Roadmap: every non-cancelled epic (position order), each carrying its
  // stories and its full sprint history. Sprints with no epic sit in
  // ungroupedSprints.
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
  // Partner-visible file uploads, each with a short-lived signed download URL
  // resolved server-side — the partner never sees a file id or an API surface.
  sharedFiles: {
    id: string;
    title: string;
    fileName: string | null;
    sizeBytes: number | null;
    contentType: string | null;
    downloadUrl: string | null;
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
      iconEmoji: true,
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

  const sprintSelect = {
    id: true,
    name: true,
    startsAt: true,
    endsAt: true,
    status: true,
  } as const;

  const [
    partnership,
    assignments,
    epicsRaw,
    ungroupedSprintRows,
    recentlyDone,
    sharedPages,
    sharedFileRows,
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
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  photoUrl: true,
                },
              },
              domain: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      // Cancelled epics are dropped work — partners never see them. Each epic
      // carries its stories (scope) and every sprint (schedule/history).
      prisma.epic.findMany({
        where: { projectId: project.id, status: { not: "Cancelled" } },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          status: true,
          startsAt: true,
          endsAt: true,
          stories: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              title: true,
              status: true,
              successMetric: true,
              acceptanceCriteria: true,
              category: true,
              priority: true,
            },
          },
          sprints: { orderBy: { startsAt: "asc" }, select: sprintSelect },
        },
      }),
      prisma.sprint.findMany({
        where: { projectId: project.id, epicId: null },
        orderBy: { startsAt: "asc" },
        select: sprintSelect,
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
      prisma.projectFile.findMany({
        where: {
          projectId: project.id,
          archivedAt: null,
          partnerVisible: true,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          currentVersion: {
            select: { fileName: true, sizeBytes: true, s3Key: true, contentType: true },
          },
        },
      }),
    ]);

  // One count pass over every sprint on the board — cheap, and it lets each
  // sprint (past, current, or planned) show its own done/total.
  const allSprintRows = [
    ...epicsRaw.flatMap((e) => e.sprints),
    ...ungroupedSprintRows,
  ];
  const counts = allSprintRows.length
    ? await prisma.task.groupBy({
        by: ["sprintId", "status"],
        where: {
          projectId: project.id,
          sprintId: { in: allSprintRows.map((s) => s.id) },
        },
        _count: { _all: true },
      })
    : [];

  type SprintRow = (typeof allSprintRows)[number];
  function toSprintCard(s: SprintRow): PartnerProjectSprint {
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

  const epics: PartnerProjectEpic[] = epicsRaw.map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    startsAt: e.startsAt?.toISOString() ?? null,
    endsAt: e.endsAt?.toISOString() ?? null,
    stories: e.stories,
    sprints: e.sprints.map(toSprintCard),
  }));
  const ungroupedSprints = ungroupedSprintRows.map(toSprintCard);

  // Dedupe the roster: one row per person, domains joined.
  const roster = new Map<
    string,
    { name: string; domains: Set<string>; photoUrl: string | null }
  >();
  for (const a of assignments) {
    const entry = roster.get(a.user.id) ?? {
      name: fullName(a.user),
      domains: new Set<string>(),
      photoUrl: a.user.photoUrl,
    };
    entry.domains.add(a.domain.name);
    roster.set(a.user.id, entry);
  }
  const team = await Promise.all(
    [...roster.values()].map(async (r) => ({
      name: r.name,
      domains: [...r.domains].sort(),
      photoUrl: await resolvePhotoUrl(r.photoUrl),
    })),
  );

  const allCards = allSprintRows.map(toSprintCard);

  // Aggregate the in-flight sprints into a single hero readout. One active
  // sprint → its name; several → a count. Deadline is the soonest end.
  const activeCards = allCards.filter((c) => c.status === "Active");
  const momentum =
    activeCards.length > 0
      ? (() => {
          const done = activeCards.reduce((sum, c) => sum + c.done, 0);
          const total = activeCards.reduce((sum, c) => sum + c.done + c.open, 0);
          const endsAt = activeCards.map((c) => c.endsAt).sort()[0];
          const daysLeft = Math.max(
            0,
            Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000),
          );
          return {
            label:
              activeCards.length === 1
                ? activeCards[0].name
                : `${activeCards.length} sprints active`,
            done,
            total,
            endsAt,
            daysLeft,
          };
        })()
      : null;

  // Soonest planned sprint anywhere on the board — the "what's next" pointer.
  const nextSprint =
    allCards
      .filter((c) => c.status === "Planned")
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;

  return {
    project: {
      id: project.id,
      name: project.name,
      iconEmoji: project.iconEmoji,
      description: project.description,
      imageUrl: await resolvePhotoUrl(project.imageUrl),
      terms: [...project.projectTerms]
        .sort((a, b) => a.term.sortKey - b.term.sortKey)
        .map((t) => t.term.code),
    },
    partnerSince: partnership?.startedAt?.toISOString() ?? null,
    currentTermCode: current?.code ?? null,
    team,
    momentum,
    epics,
    ungroupedSprints,
    nextSprint: nextSprint
      ? {
          name: nextSprint.name,
          startsAt: nextSprint.startsAt,
          endsAt: nextSprint.endsAt,
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
    sharedFiles: await Promise.all(
      sharedFileRows.map(async (f) => ({
        id: f.id,
        title: f.title,
        fileName: f.currentVersion?.fileName ?? null,
        sizeBytes: f.currentVersion?.sizeBytes ?? null,
        contentType: f.currentVersion?.contentType ?? null,
        downloadUrl: f.currentVersion?.s3Key
          ? await getDownloadUrl(f.currentVersion.s3Key)
          : null,
      })),
    ),
  };
}
