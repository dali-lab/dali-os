import { prisma } from "~/lib/db.server";
import { formatDateShort } from "~/lib/display";
import {
  createProjectPage,
  createLabMeetingPage,
  ensureMeetingNotebook,
  createNotebookTab,
  moveIntoNotebook,
  trashNotebookIfAbandoned,
  type MeetingNotebookDestination,
} from "~/lib/pages.server";
import { resolveFilingFolder, projectSlot, singletonSlot } from "~/drive/lib/drive-receivers.server";
import { meetingNotebookIdentity, meetingTypeForNotebook, termForDate } from "~/calendar/lib/meeting-notebook.server";
import { termWindows } from "~/lib/terms";
import { isCore, isProjectMember } from "~/lib/roles";
import { copyPageBody } from "~/drive/lib/page-copy.server";
import { createNotebook, loadEditableNotebook, NotebookError } from "~/calendar/lib/notebooks.server";
import { PAGE_ACCESS_SELECT, getPageAccess } from "~/lib/pageAccess.server";
import { driveFolderCrumbs } from "~/drive/lib/drive-crumbs.server";
import { isExistingChoice, type NotebookChoice, type NotebookSpaceChoice } from "~/calendar/lib/notebook-choice";
import { readDocAsBlocks } from "~/collab/read";
import { pageDocName } from "~/collab/roomName";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import { hashTemplateText, normalizeTemplateText } from "~/calendar/lib/meeting-note-template";
import { syncMeetingShares } from "~/calendar/lib/meeting-shares.server";
import { noteForOccurrence, resolveOccurrence } from "~/calendar/lib/meeting-occurrences";
import type { MeetingType } from "~/generated/prisma/client";
import { resolveMeetingOccurrence, seedMeetingRoster } from "~/calendar/lib/meeting-roster.server";

// The notebook a meeting's note for `date` is filed in, created at `dest` when
// it doesn't exist yet. Type and project are passed rather than read off the
// meeting because callers decide them before (or while) recording them.
async function ensureNotebookForNote(input: {
  meetingId: string;
  meetingType: MeetingType;
  meetingTypeLabel: string | null;
  projectId: string | null;
  date: Date;
  authorId: string;
  dest: MeetingNotebookDestination;
}): Promise<{ id: string; created?: true }> {
  const [meeting, windows] = await Promise.all([
    prisma.scheduledMeeting.findUniqueOrThrow({
      where: { id: input.meetingId },
      select: {
        title: true,
        isCoreMeeting: true,
        scopeType: true,
        scopeId: true,
        organizerId: true,
        participantUserIds: true,
        guestEmails: true,
      },
    }),
    termWindows(),
  ]);
  const identity = meetingNotebookIdentity(
    {
      ...meeting,
      meetingType: input.meetingType,
      meetingTypeLabel: input.meetingTypeLabel,
      projectId: input.projectId,
    },
    termForDate(windows, input.date),
  );
  return ensureMeetingNotebook({ ...identity, createdById: input.authorId, ...input.dest });
}

/** A meeting asset just filed. For a note, `notebookId` is the notebook it is a
 *  tab of and `createdNotebook` says whether this very call made that notebook. */
type BuiltArtifactPage = { id: string; notebookId: string | null; createdNotebook: boolean };

type ArtifactFilingInput = {
  authorId: string;
  meetingType: MeetingType;
  meetingTypeLabel: string | null;
  projectId: string | null;
  isCoreMeeting: boolean;
  /** Whiteboards only: file exactly here (beside the meeting's notebook) instead of by project, Core or the Lab. */
  fileAt?: Placement | null;
};

// Create a meeting-asset Page (note doc or whiteboard) for a meeting and return
// where it landed. Shared by createScheduledMeeting (asset requested at creation) and the
// attach* helpers (asset added to an already-created meeting) so the three
// filing paths — project (Team/Partner), Core, and General (chosen Drive
// location) — live in one place for both artifacts. `authorId` is the creator
// and the identity destination authorization runs against (the organizer at
// creation, the actor after). A whiteboard is filed in that folder directly; a
// note becomes a tab of the meeting's notebook, which sits in that folder.
export async function buildMeetingArtifactPage(
  input: ArtifactFilingInput & {
    meetingId: string;
    artifact: "note" | "whiteboard";
    startDate: Date | null;
    /** Notes only: which occurrence the note is for (see resolveOccurrence). */
    occurrenceStart?: Date;
    /** Notes only: file as a tab of this notebook instead of the type-keyed one. */
    notebookId?: string | null;
  },
): Promise<BuiltArtifactPage> {
  const noteDate = input.startDate ?? new Date();
  const dateLabel = formatDateShort(noteDate);
  const isBoard = input.artifact === "whiteboard";
  const occurrenceStart = input.occurrenceStart ?? noteDate;
  if (!isBoard && input.notebookId) {
    const tab = await createNotebookTab({
      notebookId: input.notebookId,
      title: input.projectId || !input.meetingTypeLabel ? dateLabel : `${input.meetingTypeLabel} (${dateLabel})`,
      createdById: input.authorId,
      meetingNoteId: input.meetingId,
      meetingOccurrenceStart: occurrenceStart,
    });
    return { id: tab.id, notebookId: input.notebookId, createdNotebook: false };
  }
  const { dest, title } = await resolveArtifactFiling(input, isBoard, dateLabel);
  if (!isBoard) {
    const notebook = await ensureNotebookForNote({ ...input, date: occurrenceStart, dest });
    const tab = await createNotebookTab({
      notebookId: notebook.id,
      title,
      createdById: input.authorId,
      meetingNoteId: input.meetingId,
      meetingOccurrenceStart: occurrenceStart,
    });
    return { id: tab.id, notebookId: notebook.id, createdNotebook: notebook.created === true };
  }
  const fields = {
    title,
    createdById: input.authorId,
    parentPageId: dest.parentPageId,
    meetingWhiteboardId: input.meetingId,
    kind: "Whiteboard" as const,
  };
  const page =
    dest.workspaceType === "Project" && dest.workspaceId
      ? await createProjectPage({ projectId: dest.workspaceId, ...fields })
      : await createLabMeetingPage({ ...fields, restricted: dest.restricted });
  return { id: page.id, notebookId: null, createdNotebook: false };
}

/** The title a meeting asset carries wherever it is filed. The artifact noun
 *  keeps a note and a board for the same meeting distinguishable in Drive and
 *  search; a project's Team/Partner assets are named for the project so they
 *  stay identifiable once they leave its folder. */
async function artifactTitle(input: ArtifactFilingInput, isBoard: boolean, dateLabel: string): Promise<string> {
  const plain = isBoard ? `${dateLabel} whiteboard` : dateLabel;
  if (input.projectId && (input.meetingType === "Team" || input.meetingType === "Partner")) {
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { name: true } });
    const noun = isBoard ? "whiteboard" : "meeting note";
    return project ? `${project.name} ${input.meetingType} ${noun} (${dateLabel})` : plain;
  }
  if (!input.meetingTypeLabel) return plain;
  return isBoard ? `${input.meetingTypeLabel} whiteboard (${dateLabel})` : `${input.meetingTypeLabel} (${dateLabel})`;
}

function destinationOf(p: Placement): MeetingNotebookDestination | null {
  if (p.workspaceType === "Lab") return { workspaceType: "Lab", workspaceId: null, parentPageId: p.parentPageId };
  if (p.workspaceType === "Project" && p.workspaceId) {
    return { workspaceType: "Project", workspaceId: p.workspaceId, parentPageId: p.parentPageId };
  }
  return null;
}

/** Where a meeting asset is filed (beside its notebook, in its project, Core,
 *  or the author's chosen Drive location) and the title it carries there. */
async function resolveArtifactFiling(
  input: ArtifactFilingInput,
  isBoard: boolean,
  dateLabel: string,
): Promise<{ dest: MeetingNotebookDestination; title: string }> {
  const title = await artifactTitle(input, isBoard, dateLabel);
  const file = (dest: MeetingNotebookDestination) => ({ dest, title });

  const beside = isBoard && input.fileAt ? destinationOf(input.fileAt) : null;
  if (beside) return file(beside);

  if (input.projectId) {
    const { folderId: parentPageId } = await resolveFilingFolder(projectSlot(input.projectId), input.authorId);
    return file({ workspaceType: "Project", workspaceId: input.projectId, parentPageId });
  }

  if (input.isCoreMeeting) {
    // A Core meeting's assets belong to Core, the way a project meeting's belong
    // to its project: always Core's own meeting-assets folder, never a location
    // the organizer picked. The folder is Core-scoped, so the asset is Core-only
    // without depending on its own link access.
    const { folderId: coreFolderId } = await resolveFilingFolder(singletonSlot("Core", "Meetings"), input.authorId);
    return file({
      workspaceType: "Lab",
      workspaceId: null,
      // Null only when the Core group isn't seeded yet: the asset lands at
      // the Lab root rather than not existing at all.
      parentPageId: coreFolderId,
      restricted: coreFolderId !== null,
    });
  }

  const { folderId: parentPageId } = await resolveFilingFolder(singletonSlot("Lab", "Meetings"), input.authorId);
  return file({ workspaceType: "Lab", workspaceId: null, parentPageId });
}

type Placement = { workspaceType: string; workspaceId: string | null; parentPageId: string | null };

export type ResolvedNotebook = {
  /** Set when the notebook was filed in a chosen folder: the space that folder sits in. */
  space?: NotebookSpaceChoice;
  id: string;
  title: string;
  created: boolean;
  templatePageId: string | null;
  /** Where the notebook itself lives: a link to this place is not a link. */
  primary: Placement;
};

/** A new notebook goes where its chosen space says, not where the meeting's own flags would put it. */
function filingBySpace(filing: ArtifactFilingInput, space: NotebookSpaceChoice | undefined): ArtifactFilingInput {
  switch (space?.kind) {
    case "core":
      return { ...filing, projectId: null, isCoreMeeting: true };
    case "project":
      return { ...filing, projectId: space.projectId };
    case "lab":
      return { ...filing, projectId: null, isCoreMeeting: false };
    default:
      return filing;
  }
}

const FOLDER_REFUSAL = "You can't file in that folder";

/** A folder the actor may file a new notebook in, and the space it sits in: Core
 *  under the Core root, the project for a project folder, else General. */
export async function resolveFolderFiling(
  folderPageId: string,
  actorId: string,
  request?: Request,
): Promise<{ space: NotebookSpaceChoice; dest: MeetingNotebookDestination }> {
  const folder = await prisma.page.findUnique({
    where: { id: folderPageId },
    select: { ...PAGE_ACCESS_SELECT, kind: true },
  });
  if (!folder || folder.archivedAt !== null || folder.kind !== "Folder") throw new NotebookError(FOLDER_REFUSAL, 403);
  const access = await getPageAccess(actorId, folder, request);
  if (!access.canEdit) throw new NotebookError(FOLDER_REFUSAL, 403);
  if (folder.workspaceType === "Project" && folder.workspaceId) {
    return {
      space: { kind: "project", projectId: folder.workspaceId },
      dest: { workspaceType: "Project", workspaceId: folder.workspaceId, parentPageId: folder.id },
    };
  }
  if (folder.workspaceType !== "Lab") throw new NotebookError(FOLDER_REFUSAL, 403);
  const { scope } = await driveFolderCrumbs(folder.id, actorId, request);
  return {
    space: { kind: scope === "core" ? "core" : "lab" },
    dest: { workspaceType: "Lab", workspaceId: null, parentPageId: folder.id },
  };
}

/**
 * The notebook a caller's choice names: an existing one the actor can edit, or
 * a new one made at the chosen folder (else where the meeting's About files its
 * notes). Throws NotebookError for a notebook or folder the actor can't use.
 * `filingFor` supplies the default placement once the notebook's title is known.
 */
export async function resolveNotebookChoice(
  choice: NotebookChoice,
  actorId: string,
  filingFor: (title: string) => ArtifactFilingInput,
  request?: Request,
): Promise<ResolvedNotebook> {
  if (isExistingChoice(choice)) {
    const row = await loadEditableNotebook(choice.existingId, actorId);
    const own: Placement = { workspaceType: row.workspaceType, workspaceId: row.workspaceId, parentPageId: row.parentPageId };
    return {
      id: row.id,
      title: row.title,
      created: false,
      templatePageId: row.templatePageId,
      primary: own,
    };
  }
  const folderFiling = choice.folderPageId ? await resolveFolderFiling(choice.folderPageId, actorId, request) : null;
  const dest =
    folderFiling?.dest ??
    (await resolveArtifactFiling(filingBySpace(filingFor(choice.title), choice.space), false, formatDateShort(new Date())))
      .dest;
  const created = await createNotebook({
    title: choice.title,
    workspaceType: dest.workspaceType,
    workspaceId: dest.workspaceType === "Project" ? dest.workspaceId : null,
    parentPageId: dest.parentPageId,
    templatePageId: choice.templatePageId ?? null,
    actorId,
  });
  return {
    ...(folderFiling ? { space: folderFiling.space } : {}),
    id: created.id,
    title: choice.title.trim(),
    created: true,
    templatePageId: choice.templatePageId ?? null,
    primary: {
      workspaceType: dest.workspaceType,
      workspaceId: dest.workspaceType === "Project" ? dest.workspaceId : null,
      parentPageId: dest.parentPageId,
    },
  };
}

/** The type a note filed via a notebook is recorded under: the caller's own if
 *  it gave one, else derived from the notebook (see meetingTypeForNotebook). */
export function typeForNotebookFiling(
  given: { meetingType?: MeetingType | null; meetingTypeLabel?: string | null },
  projectId: string | null,
  notebookTitle: string,
): { meetingType: MeetingType; meetingTypeLabel: string | null } {
  if (given.meetingType) return { meetingType: given.meetingType, meetingTypeLabel: given.meetingTypeLabel ?? null };
  return meetingTypeForNotebook(projectId, notebookTitle);
}

export type AttachMeetingNoteInput = {
  meetingId: string;
  /** Who is adding the note. Also the note's creator and the identity
   *  project/destination authorization runs against. */
  actorId: string;
  /** Which occurrence the note is for — any instant resolveOccurrence
   *  understands. Omitted = the first occurrence. */
  occurrence?: Date | null;
  // Only read when the meeting has no recorded type yet (its first note). A
  // meeting that already knows its type reuses it, and files each further
  // occurrence's note beside the ones before.
  meetingType?: MeetingType | null;
  meetingTypeLabel?: string | null;
  projectId?: string | null;
  /** The notebook this note files into. Omitted = the series' default, else the
   *  type-keyed notebook. Naming one is the organizer's or Core's call. */
  notebook?: NotebookChoice | null;
  request?: Request;
};

export type AttachMeetingNoteResult =
  | {
      ok: true;
      notePageId: string;
      notebookId: string | null;
      createdNotebook: boolean;
      /** The series' default notebook after this call. */
      seriesNotebookId: string | null;
    }
  | { ok: false; error: string; status: number };

/**
 * Which template page (if any) should seed a brand-new meeting note:
 * the notebook's own template, else `projectId`'s bound template, else the Lab
 * default for `meetingType`, else none. A bound page that's since been unmarked as a template or archived is
 * ignored (falls through to the Lab default) rather than erroring — the note
 * just comes back blank, same as an unset binding.
 */
export async function resolveMeetingNoteTemplate(
  projectId: string | null,
  meetingType: MeetingType,
  notebookTemplateId: string | null = null,
): Promise<{ id: string } | null> {
  if (notebookTemplateId) {
    const bound = await prisma.page.findUnique({
      where: { id: notebookTemplateId },
      select: { id: true, isTemplate: true, archivedAt: true },
    });
    if (bound && bound.isTemplate && bound.archivedAt === null) return { id: bound.id };
  }
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { meetingNoteTemplateId: true },
    });
    if (project?.meetingNoteTemplateId) {
      const bound = await prisma.page.findUnique({
        where: { id: project.meetingNoteTemplateId },
        select: { id: true, isTemplate: true, archivedAt: true },
      });
      if (bound && bound.isTemplate && bound.archivedAt === null) return { id: bound.id };
    }
  }
  return prisma.page.findFirst({
    where: { defaultMeetingNoteFor: meetingType, isTemplate: true, archivedAt: null },
    select: { id: true },
  });
}

/**
 * Fill a blank note with a template's body. The hash is of what was actually
 * written, so a later "still untouched?" check (isUntouchedTemplate) stays
 * correct even after the template itself is edited.
 */
export async function seedPageFromTemplate(notePageId: string, templateId: string): Promise<void> {
  await copyPageBody(templateId, notePageId);
  const bodyText = blocksToPlainText(await readDocAsBlocks(pageDocName(notePageId)));
  await prisma.page.update({
    where: { id: notePageId },
    data: {
      seededFromPageId: templateId,
      seededTemplateHash: hashTemplateText(normalizeTemplateText(bodyText)),
    },
  });
}

/** Seed a blank note from a bound template, if one resolves (see resolveMeetingNoteTemplate). */
export async function seedNoteFromTemplate(
  notePageId: string,
  projectId: string | null,
  meetingType: MeetingType,
  notebookTemplateId: string | null,
): Promise<void> {
  const template = await resolveMeetingNoteTemplate(projectId, meetingType, notebookTemplateId);
  if (template) await seedPageFromTemplate(notePageId, template.id);
}

/**
 * Give one occurrence of a meeting its notes doc, or return the one it has.
 *
 * A meeting's first note decides what kind of meeting it is (About →
 * project/Team/Partner/General, name, Drive location) — the same choices the
 * create form collects — so only the organizer or Core may add it. Once the
 * meeting has a type, every later occurrence of a recurring meeting gets its own
 * doc on demand, filed beside the earlier ones, by anyone taking part: that's
 * what lets each week of a team meeting keep its own notes. A Core meeting keeps
 * filing to Core's folder regardless of the chosen location (mirrors
 * createScheduledMeeting).
 */
export async function attachMeetingNote(
  input: AttachMeetingNoteInput,
): Promise<AttachMeetingNoteResult> {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      organizerId: true,
      participantUserIds: true,
      isCoreMeeting: true,
      selectedAt: true,
      createdAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      externalEventId: true,
      status: true,
      meetingType: true,
      meetingTypeLabel: true,
      projectId: true,
      notebookId: true,
      notebook: {
        select: {
          id: true,
          title: true,
          kind: true,
          archivedAt: true,
          templatePageId: true,
          workspaceType: true,
          workspaceId: true,
          parentPageId: true,
        },
      },
      notePages: {
        where: { archivedAt: null },
        select: {
          id: true,
          meetingOccurrenceStart: true,
          workspaceType: true,
          workspaceId: true,
          parentPageId: true,
          parent: { select: { kind: true, parentPageId: true } },
        },
        orderBy: { meetingOccurrenceStart: "desc" },
      },
    },
  });
  if (!meeting || meeting.status === "Cancelled") {
    return { ok: false, error: "Meeting not found", status: 404 };
  }

  const occurrence = await resolveMeetingOccurrence(meeting, input.occurrence);
  const existing = noteForOccurrence(meeting.notePages, occurrence.originalStart);
  if (existing) {
    return {
      ok: true,
      notePageId: existing.id,
      notebookId: existing.parentPageId,
      createdNotebook: false,
      seriesNotebookId: meeting.notebookId,
    };
  }

  const core = await isCore(input.actorId);
  const isOrganizer = meeting.organizerId === input.actorId;
  const previous = meeting.notePages[0] ?? null;
  const reuseType = meeting.meetingType != null;
  const chosen = input.notebook ?? null;
  // A series default that has since left use (trashed by hand) files nothing.
  const series =
    meeting.notebook && meeting.notebook.kind === "Notebook" && meeting.notebook.archivedAt === null
      ? meeting.notebook
      : null;

  if ((previous || series) && !chosen) {
    const takesPart =
      isOrganizer ||
      core ||
      meeting.participantUserIds.includes(input.actorId) ||
      (meeting.projectId !== null && (await isProjectMember(input.actorId, meeting.projectId)));
    if (!takesPart) {
      return { ok: false, error: "Only people in this meeting can add its notes", status: 403 };
    }
  } else {
    // Same authority as cancelling: the organizer owns the meeting, Core has
    // broad access. The client only shows the affordance to those two, but the
    // gate lives here. Naming a notebook is the organizer's call even when the
    // meeting already has notes.
    if (!isOrganizer && !core) {
      return { ok: false, error: "Only the organizer or Core can add notes", status: 403 };
    }
  }
  if (!reuseType) {
    if (!input.meetingType && !chosen && !series) {
      return { ok: false, error: "Choose what this meeting is about", status: 400 };
    }
    // Same hard constraint as createScheduledMeeting: a project meeting
    // (Team/Partner) needs a project.
    if ((input.meetingType === "Team" || input.meetingType === "Partner") && !input.projectId) {
      return { ok: false, error: "A project is required for Team and Partner meetings", status: 400 };
    }
    // Filing under a project requires membership (or Core) — mirrors the note
    // destinations the create form offers via /api/move-destinations.
    if (input.projectId) {
      const proj = await prisma.project.findFirst({
        where: {
          id: input.projectId,
          ...(core ? {} : { assignments: { some: { userId: input.actorId } } }),
        },
        select: { id: true },
      });
      if (!proj) return { ok: false, error: "You can't file a note under that project", status: 403 };
    }
  }

  let projectId = reuseType ? meeting.projectId : (input.projectId ?? null);
  const typeFor = (notebookTitle: string) =>
    reuseType
      ? { meetingType: meeting.meetingType!, meetingTypeLabel: meeting.meetingTypeLabel }
      : typeForNotebookFiling(input, projectId, notebookTitle);

  let plan: ResolvedNotebook | null = null;
  try {
    if (chosen) {
      plan = await resolveNotebookChoice(
        chosen,
        input.actorId,
        (title) => ({
          authorId: input.actorId,
          ...typeFor(title),
          projectId,
          isCoreMeeting: meeting.isCoreMeeting,
        }),
        input.request,
      );
    } else if (series) {
      plan = {
        id: series.id,
        title: series.title,
        created: false,
        templatePageId: series.templatePageId,
        primary: series,
      };
    }
  } catch (err) {
    if (err instanceof NotebookError) return { ok: false, error: err.message, status: err.status };
    throw err;
  }
  if (!reuseType && plan?.space?.kind === "project") projectId = plan.space.projectId;

  const { meetingType, meetingTypeLabel } = typeFor(plan?.title ?? "");

  let notePageId: string;
  let notebookId: string | null;
  let createdNotebook: boolean;
  // A trashed note still holds the occurrence's unique key; it gives it up and
  // comes back from Trash as a plain tab, so the meeting can offer a fresh one.
  await prisma.page.updateMany({
    where: { meetingNoteId: meeting.id, meetingOccurrenceStart: occurrence.originalStart, archivedAt: { not: null } },
    data: { meetingNoteId: null },
  });
  try {
    const built = await buildMeetingArtifactPage({
      meetingId: meeting.id,
      authorId: input.actorId,
      artifact: "note",
      meetingType,
      meetingTypeLabel,
      projectId,
      isCoreMeeting: meeting.isCoreMeeting,
      startDate: occurrence.start,
      occurrenceStart: occurrence.originalStart,
      notebookId: plan?.id ?? null,
    });
    notePageId = built.id;
    notebookId = built.notebookId;
    createdNotebook = plan?.created ?? built.createdNotebook;
  } catch (err) {
    // Two people opening the same occurrence's notes at once: the unique
    // (meetingNoteId, meetingOccurrenceStart) key lets one create it, and the
    // other gets that one.
    const raced = await prisma.page.findFirst({
      where: { meetingNoteId: meeting.id, meetingOccurrenceStart: occurrence.originalStart, archivedAt: null },
      select: { id: true, parentPageId: true },
    });
    if (raced) {
      return {
        ok: true,
        notePageId: raced.id,
        notebookId: raced.parentPageId,
        createdNotebook: false,
        seriesNotebookId: meeting.notebookId,
      };
    }
    throw err;
  }

  // A notebook named where the series has none becomes the series' default, so
  // later occurrences file there with no prompt. A different default stays; the
  // caller offers to change it.
  const becomesDefault = chosen !== null && plan !== null && series === null;
  const seriesNotebookId = becomesDefault ? plan!.id : (series?.id ?? null);

  if (!reuseType || becomesDefault) {
    // Record the derived type/project on the meeting so it reads the same as
    // one configured at creation (the note page is linked via its
    // meetingNoteId FK).
    await prisma.scheduledMeeting.update({
      where: { id: meeting.id },
      data: {
        ...(reuseType
          ? {}
          : {
              meetingType,
              meetingTypeLabel: meetingType === "Other" ? meetingTypeLabel : null,
              projectId,
            }),
        ...(becomesDefault ? { notebookId: plan!.id } : {}),
      },
    });
  }

  if (notebookId) await syncMeetingShares(meeting.id, input.request);

  // Backfill the attendance roster the note's checklist reads. Idempotent — a
  // SelfCheckIn meeting may already have rows, so skip the duplicates.
  await seedMeetingRoster(meeting, occurrence.originalStart);

  await seedNoteFromTemplate(notePageId, projectId, meetingType, plan?.templatePageId ?? null);

  return {
    ok: true,
    notePageId,
    notebookId,
    createdNotebook,
    seriesNotebookId,
  };
}

export type AttachMeetingWhiteboardInput = {
  meetingId: string;
  /** Who is adding the board — must be the organizer or Core, and the board's
   *  creator. */
  actorId: string;
  // Only read when the meeting has no recorded type yet (a note-less meeting).
  // When the meeting already knows its type — it has a note, or was created with
  // one — the board reuses that and files alongside it, and these are ignored.
  meetingType?: MeetingType | null;
  meetingTypeLabel?: string | null;
  projectId?: string | null;
};

export type AttachMeetingWhiteboardResult =
  | { ok: true; whiteboardPageId: string }
  | { ok: false; error: string; status: number };

/**
 * Add a whiteboard to an already-created meeting that doesn't have one. Mirrors
 * attachMeetingNote. A meeting that already knows its type (it has a note) reuses
 * it and files the board next to the note; a note-less meeting collects the type
 * the way the create form does and records it, so a whiteboard-only meeting reads
 * the same as one configured at creation.
 */
export async function attachMeetingWhiteboard(
  input: AttachMeetingWhiteboardInput,
): Promise<AttachMeetingWhiteboardResult> {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      organizerId: true,
      participantUserIds: true,
      isCoreMeeting: true,
      selectedAt: true,
      createdAt: true,
      status: true,
      title: true,
      meetingType: true,
      meetingTypeLabel: true,
      projectId: true,
      notebook: { select: { workspaceType: true, workspaceId: true, parentPageId: true } },
      whiteboardPage: { select: { id: true } },
      // The whiteboard is one per series; it files beside the first note.
      notePages: {
        select: {
          id: true,
          workspaceType: true,
          workspaceId: true,
          parentPageId: true,
          parent: { select: { kind: true, parentPageId: true } },
        },
        orderBy: { meetingOccurrenceStart: "asc" },
        take: 1,
      },
    },
  });
  if (!meeting || meeting.status === "Cancelled") {
    return { ok: false, error: "Meeting not found", status: 404 };
  }
  if (meeting.whiteboardPage) {
    return { ok: false, error: "This meeting already has a whiteboard", status: 409 };
  }

  // Same authority as adding a note: the organizer owns the meeting, Core has
  // broad access. The client only shows the affordance to those two.
  const core = await isCore(input.actorId);
  if (meeting.organizerId !== input.actorId && !core) {
    return { ok: false, error: "Only the organizer or Core can add a whiteboard", status: 403 };
  }

  // Reuse the meeting's own type when it has one (so a note + board sit side by
  // side under the same folder); otherwise take it from the caller the way the
  // add-note flow does, applying the same project constraint + membership gate.
  const useExisting = meeting.meetingType != null;
  const projectId = useExisting ? meeting.projectId : (input.projectId ?? null);
  const { meetingType, meetingTypeLabel } = useExisting
    ? { meetingType: meeting.meetingType!, meetingTypeLabel: meeting.meetingTypeLabel }
    : typeForNotebookFiling(input, projectId, meeting.title);

  if ((meetingType === "Team" || meetingType === "Partner") && !projectId) {
    return { ok: false, error: "A project is required for Team and Partner meetings", status: 400 };
  }
  if (!useExisting && projectId) {
    const proj = await prisma.project.findFirst({
      where: {
        id: projectId,
        ...(core ? {} : { assignments: { some: { userId: input.actorId } } }),
      },
      select: { id: true },
    });
    if (!proj) {
      return { ok: false, error: "You can't file a whiteboard under that project", status: 403 };
    }
  }

  const { id: whiteboardPageId } = await buildMeetingArtifactPage({
    meetingId: meeting.id,
    authorId: input.actorId,
    artifact: "whiteboard",
    meetingType,
    meetingTypeLabel: meetingType === "Other" ? meetingTypeLabel : null,
    projectId: projectId ?? null,
    isCoreMeeting: meeting.isCoreMeeting,
    fileAt: meeting.notebook,
    startDate: meeting.selectedAt,
  });

  // Record the derived type on a note-less meeting so it reads the same as one
  // configured at creation (a meeting that already had a type keeps it).
  if (!useExisting) {
    await prisma.scheduledMeeting.update({
      where: { id: meeting.id },
      data: {
        meetingType,
        meetingTypeLabel: meetingType === "Other" ? meetingTypeLabel : null,
        projectId: projectId ?? null,
      },
    });
  }

  // Backfill the attendance roster (idempotent — a note or SelfCheckIn meeting
  // may already have rows).
  await seedMeetingRoster(meeting);

  return { ok: true, whiteboardPageId };
}

// Re-file an existing meeting note / whiteboard into a project's meeting-notes
// folder — used when a project is added to a meeting after creation, so its
// artifacts move to where a project meeting's would have been filed. Mirrors
// buildMeetingArtifactPage's project branch (folder + title) and the page-move
// route's access reset for a scoped (non-Lab) destination: the project's scope,
// not a lab-wide link grant, governs who can see it now.
async function refileMeetingArtifactToProject(input: {
  meetingId: string;
  pageId: string;
  isBoard: boolean;
  projectId: string;
  projectName: string;
  meetingType: MeetingType;
  meetingTypeLabel: string | null;
  authorId: string;
  startDate: Date | null;
}): Promise<string | null> {
  const dateLabel = formatDateShort(input.startDate ?? new Date());
  const noun = input.isBoard ? "whiteboard" : "meeting note";
  const { folderId: parentPageId } = await resolveFilingFolder(projectSlot(input.projectId), input.authorId);
  let title: string;
  if (input.meetingType === "Team" || input.meetingType === "Partner") {
    title = `${input.projectName} ${input.meetingType} ${noun} (${dateLabel})`;
  } else {
    // "Other": no default folder for a custom label, so it sits at the project
    // top level, named for that label — same as the create path.
    const label = input.meetingTypeLabel ?? "Meeting";
    title = input.isBoard ? `${label} whiteboard (${dateLabel})` : `${label} (${dateLabel})`;
  }
  if (!input.isBoard) {
    // A note changes notebook along with its meeting's type and project.
    const notebook = await ensureNotebookForNote({
      ...input,
      date: input.startDate ?? new Date(),
      dest: { workspaceType: "Project", workspaceId: input.projectId, parentPageId },
    });
    await moveIntoNotebook(input.pageId, notebook.id, title);
    return notebook.id;
  }
  await prisma.page.update({
    where: { id: input.pageId },
    data: {
      workspaceType: "Project",
      workspaceId: input.projectId,
      parentPageId,
      title,
      // A pin means "top of THIS view", and partner/public sharing is a
      // project's own concern — reset on the way in, like the move route.
      pinnedAt: null,
      partnerVisible: false,
      publicVisible: false,
      linkAccess: "Restricted",
      linkPermission: "View",
    },
  });
  return null;
}

export type SetMeetingProjectInput = {
  meetingId: string;
  /** Who is setting the project — must be the organizer or Core, and the
   *  identity project membership is checked against. */
  actorId: string;
  projectId: string;
  meetingType: MeetingType;
  meetingTypeLabel?: string | null;
};

export type SetMeetingProjectResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Associate an existing meeting with a project after creation — the inverse of
 * the create form's About step, which is otherwise frozen once a meeting exists.
 * Sets meetingType/project and re-files any existing note/whiteboard into the
 * project's meeting-notes folder. isCoreMeeting is left as-is, so a Core meeting
 * becomes both. A note-less meeting just records the association (+ its
 * attendance roster). Reversing it (back to Core/General) is not handled here.
 */
export async function setMeetingProject(
  input: SetMeetingProjectInput,
): Promise<SetMeetingProjectResult> {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      organizerId: true,
      participantUserIds: true,
      status: true,
      selectedAt: true,
      createdAt: true,
      meetingType: true,
      notebookId: true,
      notePages: {
        where: { archivedAt: null },
        select: { id: true, kind: true, meetingOccurrenceStart: true },
        orderBy: { meetingOccurrenceStart: "desc" },
      },
      whiteboardPage: { select: { id: true, kind: true } },
    },
  });
  if (!meeting || meeting.status === "Cancelled") {
    return { ok: false, error: "Meeting not found", status: 404 };
  }

  // Same authority as attachMeetingNote: the organizer owns the meeting, Core
  // has broad access. The client only shows the affordance to those two.
  const core = await isCore(input.actorId);
  if (meeting.organizerId !== input.actorId && !core) {
    return { ok: false, error: "Only the organizer or Core can set a meeting's project", status: 403 };
  }

  if (input.meetingType === "Other" && !input.meetingTypeLabel?.trim()) {
    return { ok: false, error: "A name is required for an \"Other\" meeting", status: 400 };
  }

  // Filing under a project requires membership (or Core) — mirrors the project
  // set /api/move-destinations offers and attachMeetingNote's own check.
  const proj = await prisma.project.findFirst({
    where: {
      id: input.projectId,
      ...(core ? {} : { assignments: { some: { userId: input.actorId } } }),
    },
    select: { id: true, name: true },
  });
  if (!proj) {
    return { ok: false, error: "You can't file this meeting under that project", status: 403 };
  }

  const meetingTypeLabel =
    input.meetingType === "Other" ? (input.meetingTypeLabel?.trim() || null) : null;

  const artifacts = [
    ...meeting.notePages.map((p) => ({ ...p, date: p.meetingOccurrenceStart ?? meeting.selectedAt })),
    ...(meeting.whiteboardPage ? [{ ...meeting.whiteboardPage, date: meeting.selectedAt }] : []),
  ];
  let notebookId: string | null = null;
  for (const page of artifacts) {
    const filedIn = await refileMeetingArtifactToProject({
      meetingId: meeting.id,
      pageId: page.id,
      isBoard: page.kind === "Whiteboard",
      projectId: proj.id,
      projectName: proj.name,
      meetingType: input.meetingType,
      meetingTypeLabel,
      authorId: input.actorId,
      startDate: page.date,
    });
    notebookId ??= filedIn;
  }

  await prisma.scheduledMeeting.update({
    where: { id: meeting.id },
    data: {
      meetingType: input.meetingType,
      meetingTypeLabel,
      projectId: proj.id,
      ...(notebookId ? { notebookId } : {}),
    },
  });
  if (notebookId && meeting.notebookId && meeting.notebookId !== notebookId) {
    await trashNotebookIfAbandoned(meeting.notebookId);
  }
  if (artifacts.length > 0) await syncMeetingShares(meeting.id);

  // A meeting that had no type yet had no attendance roster — back it up now
  // (idempotent) so the note's checklist has rows. One that already had a type
  // already has its rows.
  if (!meeting.meetingType) await seedMeetingRoster(meeting);

  return { ok: true };
}
