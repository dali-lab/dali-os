import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { getDownloadUrl } from "~/lib/s3";
import { fullName } from "~/lib/display";
import { buildTimelineEpics } from "~/projects/lib/timeline-epics";
import type {
  TimelineEpic,
  TimelineTerm,
} from "~/projects/components/EpicsTimeline";

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

// A sprint reduced to its progress counts. Sprints are no longer a surface of
// their own on the partner hub — the timeline draws the work — but the live
// ones still feed the hero readout at the top of the page.
type SprintProgress = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "Active" | "Closed" | "Planned";
  done: number;
  open: number;
};

// One shelf of the partner's Drive: collab-doc pages and uploaded files
// together, the way the project hub's own Drive block reads.
export type PartnerDriveDoc = {
  id: string;
  title: string;
  iconEmoji: string | null;
  updatedAt: string;
};

// Partner-visible file uploads, each with a short-lived signed download URL
// resolved server-side — the partner never sees a file id or an API surface.
export type PartnerDriveFile = {
  id: string;
  title: string;
  fileName: string | null;
  sizeBytes: number | null;
  contentType: string | null;
  downloadUrl: string | null;
};

export type PartnerDriveFolder = {
  id: string;
  title: string;
  docs: PartnerDriveDoc[];
  files: PartnerDriveFile[];
};

export type PartnerDrive = {
  // Folders holding at least one shared item, in tree order. A folder is never
  // listed for its own sake — it appears because something inside it was
  // shared, and it shows only the shared items in it.
  folders: PartnerDriveFolder[];
  docs: PartnerDriveDoc[];
  files: PartnerDriveFile[];
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
  // The same bars the project hub's planning timeline draws, built by the same
  // resolver — minus the task level, which the partner hub hides. Every
  // non-cancelled epic, in position order.
  timelineEpics: TimelineEpic[];
  timelineTerms: TimelineTerm[];
  nextSprint: { name: string; startsAt: string; endsAt: string } | null;
  recentlyDone: {
    id: string;
    title: string;
    doneAt: string;
    domain: string | null;
  }[];
  drive: PartnerDrive;
};

// The whole partner read-surface for a project: the planning timeline, roster,
// recently-closed tasks, and the shared Drive. Shared by the real partner
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
        select: {
          term: {
            select: { code: true, sortKey: true, startDate: true, endDate: true },
          },
        },
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
    sprintRows,
    storyTaskRows,
    recentlyDone,
    pageRows,
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
      // Cancelled epics are dropped work — partners never see them. Stories
      // come along because they're the timeline's second level of bars.
      prisma.epic.findMany({
        where: { projectId: project.id, status: { not: "Cancelled" } },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          startsAt: true,
          endsAt: true,
          stories: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              title: true,
              notes: true,
              status: true,
              startsAt: true,
              endsAt: true,
            },
          },
        },
      }),
      prisma.sprint.findMany({
        where: { projectId: project.id },
        orderBy: { startsAt: "asc" },
        select: { ...sprintSelect, epicId: true },
      }),
      // Dates only. Tasks never reach the partner — they're read here because a
      // story with no dates of its own is placed by the tasks under it, and a
      // partner's story bar has to land where the internal timeline puts it.
      prisma.task.findMany({
        where: { projectId: project.id, archivedAt: null, storyId: { not: null } },
        select: { id: true, storyId: true, startsAt: true, dueAt: true },
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
      // Shared docs, plus every folder — folders carry no partnerVisible flag
      // of their own, so which ones a partner sees falls out of what's in them
      // (filtered below).
      prisma.page.findMany({
        where: {
          workspaceType: "Project",
          workspaceId: project.id,
          archivedAt: null,
          OR: [{ partnerVisible: true }, { kind: "Folder" }],
        },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          kind: true,
          parentPageId: true,
          partnerVisible: true,
          iconEmoji: true,
          updatedAt: true,
        },
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
          folderPageId: true,
          currentVersion: {
            select: { fileName: true, sizeBytes: true, s3Key: true, contentType: true },
          },
        },
      }),
    ]);

  // One count pass over every sprint on the board — cheap, and it's what the
  // hero readout aggregates.
  const counts = sprintRows.length
    ? await prisma.task.groupBy({
        by: ["sprintId", "status"],
        where: {
          projectId: project.id,
          sprintId: { in: sprintRows.map((s) => s.id) },
        },
        _count: { _all: true },
      })
    : [];

  const sprintProgress: SprintProgress[] = sprintRows.map((s) => {
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
  });

  // The same span resolution the project hub runs, with the task level left
  // empty: partners see what's being built and when, not who is on which card.
  const timelineEpics = buildTimelineEpics({
    epics: epicsRaw,
    sprints: sprintRows,
    tasks: storyTaskRows,
    includeTasks: false,
  });

  // Term spans anchor the fixed one-week sprint grid and label its bands.
  const timelineTerms: TimelineTerm[] = [...project.projectTerms]
    .sort((a, b) => a.term.sortKey - b.term.sortKey)
    .map((t) => ({
      code: t.term.code,
      startsAt: t.term.startDate.toISOString(),
      endsAt: t.term.endDate.toISOString(),
    }));

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

  // Aggregate the in-flight sprints into a single hero readout. One active
  // sprint → its name; several → a count. Deadline is the soonest end.
  const activeCards = sprintProgress.filter((c) => c.status === "Active");
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
    sprintProgress
      .filter((c) => c.status === "Planned")
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;

  const toDriveFile = async (
    f: (typeof sharedFileRows)[number],
  ): Promise<PartnerDriveFile> => ({
    id: f.id,
    title: f.title,
    fileName: f.currentVersion?.fileName ?? null,
    sizeBytes: f.currentVersion?.sizeBytes ?? null,
    contentType: f.currentVersion?.contentType ?? null,
    downloadUrl: f.currentVersion?.s3Key
      ? await getDownloadUrl(f.currentVersion.s3Key)
      : null,
  });

  const folderRows = pageRows.filter((p) => p.kind === "Folder");
  const folderIds = new Set(folderRows.map((f) => f.id));
  const sharedDocRows = pageRows.filter(
    (p) => p.kind !== "Folder" && p.partnerVisible,
  );
  const driveFiles = await Promise.all(sharedFileRows.map(toDriveFile));
  const filesById = new Map(driveFiles.map((f, i) => [sharedFileRows[i].id, f]));

  const toDriveDoc = (p: (typeof sharedDocRows)[number]): PartnerDriveDoc => ({
    id: p.id,
    title: p.title,
    iconEmoji: p.iconEmoji,
    updatedAt: p.updatedAt.toISOString(),
  });

  // A doc or file whose folder isn't in the tree (archived out from under it)
  // falls back to the root rather than disappearing.
  const inFolder = (id: string | null) => (id && folderIds.has(id) ? id : null);

  const folders = folderRows
    .map((f) => ({
      id: f.id,
      title: f.title,
      docs: sharedDocRows
        .filter((p) => inFolder(p.parentPageId) === f.id)
        .map(toDriveDoc),
      files: sharedFileRows
        .filter((r) => inFolder(r.folderPageId) === f.id)
        .map((r) => filesById.get(r.id)!),
    }))
    .filter((f) => f.docs.length > 0 || f.files.length > 0);

  const drive: PartnerDrive = {
    folders,
    docs: sharedDocRows
      .filter((p) => inFolder(p.parentPageId) === null)
      .map(toDriveDoc),
    files: sharedFileRows
      .filter((r) => inFolder(r.folderPageId) === null)
      .map((r) => filesById.get(r.id)!),
  };

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
    timelineEpics,
    timelineTerms,
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
    drive,
  };
}
