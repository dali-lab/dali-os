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
import type { EditableEpic } from "~/projects/components/EpicSprintManager";

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
  // The same bars the project hub's planning timeline draws, built by the same
  // resolver — minus the task level, which the partner hub hides. Every
  // non-cancelled epic, in position order.
  timelineEpics: TimelineEpic[];
  timelineTerms: TimelineTerm[];
  // The same epics again, in the shape the project hub's detail modal reads —
  // clicking a bar opens that modal here too, read-only. Deliberately thinner
  // than the hub's copy: see toEditableEpic.
  editableEpics: EditableEpic[];
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
      // Dates only — sprints are not a surface of their own here; an epic with
      // no dates of its own is placed by the sprints under it.
      prisma.sprint.findMany({
        where: { projectId: project.id },
        select: { epicId: true, startsAt: true, endsAt: true },
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

  // The same span resolution the project hub runs, with the task level left
  // empty: partners see what's being built and when, not who is on which card.
  const timelineEpics = buildTimelineEpics({
    epics: epicsRaw,
    sprints: sprintRows,
    tasks: storyTaskRows,
    includeTasks: false,
  });

  // What the read-only detail modal actually renders, and nothing else. The
  // modal shows an epic's status, dates, plain-text description and the *names*
  // of its stories; it never renders a story's success metric, acceptance
  // criteria, category, priority or dependency edges, so those don't travel to
  // a partner's browser just to satisfy the shape. `notes` does, because the
  // "still needs its details" dot is derived from it.
  //
  // descriptionDocId is dropped for the same reason: the collab room behind an
  // epic description isn't shared with partners, and passing the id would only
  // buy them a "Sign in again to see the description" they can never satisfy.
  const editableEpics: EditableEpic[] = epicsRaw.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    status: e.status,
    startsAt: e.startsAt?.toISOString() ?? null,
    endsAt: e.endsAt?.toISOString() ?? null,
    targetTermId: null,
    descriptionDocId: null,
    stories: e.stories.map((st) => ({
      id: st.id,
      title: st.title,
      notes: st.notes,
      status: st.status,
      startsAt: st.startsAt?.toISOString() ?? null,
      endsAt: st.endsAt?.toISOString() ?? null,
      dependsOn: [],
      successMetric: null,
      acceptanceCriteria: null,
      category: null,
      priority: null,
    })),
  }));

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
    timelineEpics,
    timelineTerms,
    editableEpics,
    recentlyDone: recentlyDone.map((t) => ({
      id: t.id,
      title: t.title,
      doneAt: t.updatedAt.toISOString(),
      domain: t.domain?.displayName ?? null,
    })),
    drive,
  };
}
