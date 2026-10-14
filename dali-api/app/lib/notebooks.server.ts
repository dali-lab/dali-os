import { prisma } from "~/lib/db";
import type { WorkspaceType } from "~/generated/prisma/client";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import {
  getPageAccess,
  getPageAccessBulk,
  isUnderGoverningScope,
  PAGE_ACCESS_SELECT,
  type PageShape,
} from "~/lib/pageAccess.server";
import {
  collectSubtree,
  createLabPage,
  createProjectPage,
  MAX_PAGE_DEPTH,
  moveIntoNotebook,
  pageDepth,
} from "~/lib/pages";
import { resolveMeetingOccurrence } from "~/lib/scheduled-meeting";
import { removeMeetingShares, syncMeetingShares } from "~/lib/meeting-shares.server";

// A notebook is a Page of kind Notebook with no body; its tabs are its child
// pages. Renaming one is the ordinary page rename (POST /api/documents/:id), so
// there is no renameNotebook here.

export class NotebookError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "NotebookError";
  }
}

/** The JSON response for a NotebookError; anything else is rethrown. */
export function notebookErrorResponse(err: unknown): Response {
  if (err instanceof NotebookError) return Response.json({ error: err.message }, { status: err.status });
  throw err;
}

const notebookRowSelect = {
  ...PAGE_ACCESS_SELECT,
  kind: true,
  title: true,
  notebookKey: true,
  templatePageId: true,
} as const;

/** A live notebook the actor can edit. 404 hides one they cannot see. */
export async function loadEditableNotebook(notebookId: string, actorId: string, request?: Request) {
  const notebook = await prisma.page.findUnique({ where: { id: notebookId }, select: notebookRowSelect });
  if (!notebook || notebook.kind !== "Notebook" || notebook.archivedAt !== null) {
    throw new NotebookError("Notebook not found", 404);
  }
  const access = await getPageAccess(actorId, notebook, request);
  if (!access.canView) throw new NotebookError("Notebook not found", 404);
  if (!access.canEdit) throw new NotebookError("You can't edit this notebook", 403);
  return notebook;
}

export async function canManageNotebook(
  userId: string,
  notebook: { id: string; createdById?: string | null } & PageShape,
  request?: Request,
): Promise<boolean> {
  const base = await getPageAccess(userId, notebook, request, { ignoreShares: true });
  if (base.canEdit || notebook.createdById === userId) return true;
  const organizing = await prisma.scheduledMeeting.findFirst({
    where: { notebookId: notebook.id, organizerId: userId },
    select: { id: true },
  });
  return organizing !== null;
}

/** A live notebook the actor can restructure, not just write in. */
export async function loadManageableNotebook(notebookId: string, actorId: string, request?: Request) {
  const notebook = await loadEditableNotebook(notebookId, actorId, request);
  if (!(await canManageNotebook(actorId, notebook, request))) {
    throw new NotebookError("You can't manage this notebook", 403);
  }
  return notebook;
}

async function assertCanEditFolder(folderId: string | null, actorId: string) {
  if (!folderId) return;
  const access = await getPageAccess(actorId, folderId);
  if (!access.canEdit) throw new NotebookError("You can't put things in that folder", 403);
}

async function assertViewableTemplate(templatePageId: string, actorId: string) {
  const template = await prisma.page.findUnique({
    where: { id: templatePageId },
    select: { ...PAGE_ACCESS_SELECT, isTemplate: true },
  });
  if (!template || template.archivedAt !== null || !template.isTemplate) {
    throw new NotebookError("Template not found", 404);
  }
  const access = await getPageAccess(actorId, template);
  if (!access.canView) throw new NotebookError("Template not found", 404);
}

async function assertOrganizerOrCore(organizerId: string, actorId: string, what: string) {
  if (organizerId === actorId) return;
  if (!(await isCore(actorId))) {
    throw new NotebookError(`Only the organizer or Core can ${what}`, 403);
  }
}

async function nextPosition(workspaceType: WorkspaceType, workspaceId: string | null, parentPageId: string | null) {
  const last = await prisma.page.findFirst({
    where: { workspaceType, workspaceId, parentPageId, archivedAt: null },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
}

/** Archive data for a notebook that is leaving use. A legacy auto-grouping key
 *  is freed so the next note for it starts a fresh notebook. */
function retireData(notebook: { id: string; notebookKey: string | null }) {
  return {
    archivedAt: new Date(),
    ...(notebook.notebookKey ? { notebookKey: `${notebook.notebookKey}#${notebook.id}` } : {}),
  };
}

export async function createNotebook(input: {
  title: string;
  workspaceType: "Lab" | "Project";
  workspaceId: string | null;
  parentPageId: string | null;
  templatePageId: string | null;
  actorId: string;
}): Promise<{ id: string }> {
  const title = input.title.trim();
  if (!title) throw new NotebookError("A notebook needs a name", 400);

  if (input.workspaceType === "Project") {
    if (!input.workspaceId) throw new NotebookError("A project notebook needs a project", 400);
    const [core, member, project] = await Promise.all([
      isCore(input.actorId),
      isProjectMember(input.actorId, input.workspaceId),
      prisma.project.findUnique({ where: { id: input.workspaceId }, select: { id: true } }),
    ]);
    if (!core && !member) throw new NotebookError("You can't add to that project", 403);
    if (!project) throw new NotebookError("Project not found", 404);
  } else if (!(await isLabMember(input.actorId))) {
    throw new NotebookError("Only lab members can add notebooks", 403);
  }

  const workspaceId = input.workspaceType === "Lab" ? null : input.workspaceId;
  if (input.parentPageId) {
    const parent = await prisma.page.findUnique({
      where: { id: input.parentPageId },
      select: { workspaceType: true, workspaceId: true, kind: true, archivedAt: true },
    });
    if (
      !parent ||
      parent.archivedAt !== null ||
      parent.workspaceType !== input.workspaceType ||
      parent.workspaceId !== workspaceId
    ) {
      throw new NotebookError("Parent folder not found", 404);
    }
    if (parent.kind !== "Folder") throw new NotebookError("Notebooks can only nest inside a folder", 400);
    // The notebook and its tabs each take a level.
    const depth = await pageDepth(input.parentPageId);
    if (depth < 0 || depth + 2 > MAX_PAGE_DEPTH) throw new NotebookError("Folder is too deeply nested", 400);
    await assertCanEditFolder(input.parentPageId, input.actorId);
  }

  if (input.templatePageId) await assertViewableTemplate(input.templatePageId, input.actorId);

  const created =
    input.workspaceType === "Project"
      ? await createProjectPage({
          projectId: input.workspaceId!,
          title,
          createdById: input.actorId,
          parentPageId: input.parentPageId,
          kind: "Notebook",
        })
      : await createLabPage({
          title,
          createdById: input.actorId,
          parentPageId: input.parentPageId,
          kind: "Notebook",
          restricted: await isUnderGoverningScope(input.parentPageId),
        });

  if (input.templatePageId) {
    await prisma.page.update({ where: { id: created.id }, data: { templatePageId: input.templatePageId } });
  }
  return { id: created.id };
}

export async function getNotebook(notebookId: string, actorId: string) {
  const notebook = await prisma.page.findUnique({
    where: { id: notebookId },
    select: {
      ...notebookRowSelect,
      iconEmoji: true,
      templatePage: { select: { id: true, title: true } },
      seriesUsingAsNotebook: { select: { id: true, title: true } },
    },
  });
  if (!notebook || notebook.kind !== "Notebook" || notebook.archivedAt !== null) {
    throw new NotebookError("Notebook not found", 404);
  }
  const access = await getPageAccess(actorId, notebook);
  if (!access.canView) throw new NotebookError("Notebook not found", 404);

  const tabRows = await prisma.page.findMany({
    where: { parentPageId: notebookId, archivedAt: null },
    orderBy: [{ meetingOccurrenceStart: "desc" }, { position: "asc" }],
    select: { ...PAGE_ACCESS_SELECT, title: true, kind: true, meetingNoteId: true, meetingOccurrenceStart: true },
  });
  const tabAccess = await getPageAccessBulk(actorId, tabRows);
  const tabs = tabRows
    .filter((t) => tabAccess.get(t.id)?.canView)
    .map((t) => ({
      id: t.id,
      title: t.title,
      kind: t.kind,
      meetingNoteId: t.meetingNoteId,
      meetingOccurrenceStart: t.meetingOccurrenceStart,
    }));

  return {
    id: notebook.id,
    title: notebook.title,
    iconEmoji: notebook.iconEmoji,
    workspaceType: notebook.workspaceType,
    workspaceId: notebook.workspaceId,
    parentPageId: notebook.parentPageId,
    templatePage: notebook.templatePage,
    series: notebook.seriesUsingAsNotebook,
    canEdit: access.canEdit,
    tabs,
  };
}

export async function setNotebookTemplate(
  notebookId: string,
  templatePageId: string | null,
  actorId: string,
): Promise<void> {
  await loadManageableNotebook(notebookId, actorId);
  if (templatePageId) await assertViewableTemplate(templatePageId, actorId);
  await prisma.page.update({ where: { id: notebookId }, data: { templatePageId } });
}

/**
 * File a doc or meeting note as a tab of a notebook. Needs edit on both. A note
 * keeps its meeting link; a plain doc becomes a tab labelled by its title. The
 * notebook the page left is trashed when that emptied it.
 */
export async function addToNotebook(pageId: string, notebookId: string, actorId: string): Promise<void> {
  const notebook = await loadEditableNotebook(notebookId, actorId);
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      ...PAGE_ACCESS_SELECT,
      kind: true,
      projectAsOverview: { select: { id: true } },
      projectAsPRD: { select: { id: true } },
    },
  });
  if (!page || page.archivedAt !== null) throw new NotebookError("Document not found", 404);
  const access = await getPageAccess(actorId, page);
  if (!access.canView) throw new NotebookError("Document not found", 404);
  if (!access.canEdit) throw new NotebookError("You can't move this document", 403);
  if (page.kind !== "FreeForm") throw new NotebookError("Only documents can be added to a notebook", 400);
  if (page.projectAsOverview || page.projectAsPRD) {
    throw new NotebookError("The Overview and PRD docs can't be moved", 400);
  }
  if (page.workspaceType === "EducationOffering") {
    throw new NotebookError("Course documents can't be added to a notebook", 400);
  }
  if (page.id === notebook.id) throw new NotebookError("A notebook can't be added to itself", 400);
  await moveIntoNotebook(pageId, notebookId);
}

/**
 * Turn a meeting note into a plain doc: both meeting columns are cleared
 * together (which frees the occurrence) and the page moves out to the folder
 * its notebook lives in. A notebook this empties is trashed.
 */
export async function detachNote(pageId: string, actorId: string): Promise<void> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      ...PAGE_ACCESS_SELECT,
      meetingNoteId: true,
      parent: { select: { ...PAGE_ACCESS_SELECT, kind: true } },
    },
  });
  if (!page || page.archivedAt !== null) throw new NotebookError("Document not found", 404);
  const access = await getPageAccess(actorId, page);
  if (!access.canView) throw new NotebookError("Document not found", 404);
  if (!access.canEdit) throw new NotebookError("You can't edit this document", 403);
  if (!page.meetingNoteId) throw new NotebookError("This document isn't a meeting note", 400);

  const notebook = page.parent?.kind === "Notebook" ? page.parent : null;
  if (notebook && !(await canManageNotebook(actorId, notebook))) {
    throw new NotebookError("You can't manage this notebook", 403);
  }
  if (!notebook) {
    await prisma.page.update({
      where: { id: pageId },
      data: { meetingNoteId: null, meetingOccurrenceStart: null },
    });
    return;
  }

  await assertCanEditFolder(notebook.parentPageId, actorId);
  await prisma.page.update({
    where: { id: pageId },
    data: {
      meetingNoteId: null,
      meetingOccurrenceStart: null,
      parentPageId: notebook.parentPageId,
      position: await nextPosition(page.workspaceType, page.workspaceId, notebook.parentPageId),
      pinnedAt: null,
    },
  });
  const left = await prisma.page.count({ where: { parentPageId: notebook.id, archivedAt: null } });
  if (left === 0) await prisma.page.update({ where: { id: notebook.id }, data: { archivedAt: new Date() } });
}

/**
 * Make a plain doc the note for one occurrence of a meeting. The occurrence
 * must have no note, live or in the trash. The page stays where it is, unless
 * the series has a default notebook the actor can edit and the page is not in
 * it: then it moves in.
 */
export async function attachNote(
  pageId: string,
  meetingId: string,
  occurrenceStart: Date | null,
  actorId: string,
): Promise<{ movedIntoNotebook: boolean }> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { ...PAGE_ACCESS_SELECT, kind: true, meetingNoteId: true },
  });
  if (!page || page.archivedAt !== null) throw new NotebookError("Document not found", 404);
  const access = await getPageAccess(actorId, page);
  if (!access.canView) throw new NotebookError("Document not found", 404);
  if (!access.canEdit) throw new NotebookError("You can't edit this document", 403);
  if (page.kind !== "FreeForm") throw new NotebookError("Only documents can be meeting notes", 400);
  if (page.meetingNoteId) throw new NotebookError("This document is already a meeting note", 409);

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      organizerId: true,
      status: true,
      notebookId: true,
      selectedAt: true,
      createdAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      externalEventId: true,
    },
  });
  if (!meeting || meeting.status === "Cancelled") throw new NotebookError("Meeting not found", 404);
  await assertOrganizerOrCore(meeting.organizerId, actorId, "attach notes to a meeting");

  const occurrence = await resolveMeetingOccurrence(meeting, occurrenceStart);
  const holder = await prisma.page.findFirst({
    where: { meetingNoteId: meeting.id, meetingOccurrenceStart: occurrence.originalStart },
    select: { id: true, archivedAt: true },
  });
  if (holder) {
    throw new NotebookError(
      holder.archivedAt === null
        ? "That occurrence already has a note"
        : "That occurrence has a note in the trash. Delete it from Trash first",
      409,
    );
  }

  try {
    await prisma.page.update({
      where: { id: pageId },
      data: { meetingNoteId: meeting.id, meetingOccurrenceStart: occurrence.originalStart },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw new NotebookError("That occurrence already has a note", 409);
    }
    throw err;
  }

  if (!meeting.notebookId) return { movedIntoNotebook: false };
  await syncMeetingShares(meeting.id);
  if (page.parentPageId === meeting.notebookId) return { movedIntoNotebook: false };
  try {
    await addToNotebook(pageId, meeting.notebookId, actorId);
    return { movedIntoNotebook: true };
  } catch (err) {
    // The note is attached either way; a notebook the actor can't file into
    // just leaves it where it is.
    if (err instanceof NotebookError) return { movedIntoNotebook: false };
    throw err;
  }
}

/**
 * Set a series' default notebook. "future" only changes the default that later
 * occurrences file into; "all" also moves the series' live notes in (a note the
 * actor can't edit stays where it is and is counted as skipped).
 */
export async function setSeriesNotebook(
  meetingId: string,
  notebookId: string | null,
  options: { scope: "future" | "all" },
  actorId: string,
): Promise<{ moved: number; skipped: number }> {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: { id: true, organizerId: true, status: true },
  });
  if (!meeting || meeting.status === "Cancelled") throw new NotebookError("Meeting not found", 404);
  await assertOrganizerOrCore(meeting.organizerId, actorId, "change a meeting's notebook");
  if (notebookId) await loadEditableNotebook(notebookId, actorId);

  await prisma.scheduledMeeting.update({ where: { id: meeting.id }, data: { notebookId } });
  await syncMeetingShares(meeting.id);
  if (options.scope !== "all" || !notebookId) return { moved: 0, skipped: 0 };

  const notes = await prisma.page.findMany({
    where: { meetingNoteId: meeting.id, archivedAt: null },
    select: { id: true, parentPageId: true },
  });
  let moved = 0;
  let skipped = 0;
  for (const note of notes) {
    if (note.parentPageId === notebookId) continue;
    try {
      await addToNotebook(note.id, notebookId, actorId);
      moved++;
    } catch (err) {
      if (!(err instanceof NotebookError)) throw err;
      skipped++;
    }
  }
  return { moved, skipped };
}

/** Move every live tab of `sourceId` into `targetId`, point the series that
 *  used the source at the target, and retire the source. */
export async function mergeNotebooks(sourceId: string, targetId: string, actorId: string): Promise<{ moved: number }> {
  if (sourceId === targetId) throw new NotebookError("A notebook can't be merged into itself", 400);
  const [source] = await Promise.all([
    loadManageableNotebook(sourceId, actorId),
    loadEditableNotebook(targetId, actorId),
  ]);
  const tabs = await prisma.page.findMany({
    where: { parentPageId: sourceId, archivedAt: null },
    orderBy: [{ meetingOccurrenceStart: "asc" }, { position: "asc" }],
    select: { id: true },
  });
  for (const tab of tabs) await moveIntoNotebook(tab.id, targetId);
  const meetings = await prisma.scheduledMeeting.findMany({ where: { notebookId: sourceId }, select: { id: true } });
  await prisma.scheduledMeeting.updateMany({ where: { notebookId: sourceId }, data: { notebookId: targetId } });
  await prisma.page.update({ where: { id: sourceId }, data: retireData(source) });
  for (const m of meetings) await syncMeetingShares(m.id);
  return { moved: tabs.length };
}

/** Every tab becomes a plain doc in the notebook's folder (a note keeps its
 *  meeting link), the series stop pointing at it, and the notebook is archived. */
export async function dissolveNotebook(notebookId: string, actorId: string): Promise<{ moved: number }> {
  const notebook = await loadManageableNotebook(notebookId, actorId);
  await assertCanEditFolder(notebook.parentPageId, actorId);
  const [tabs, base, meetings] = await Promise.all([
    prisma.page.findMany({
      where: { parentPageId: notebookId, archivedAt: null },
      orderBy: [{ meetingOccurrenceStart: "asc" }, { position: "asc" }],
      select: { id: true },
    }),
    nextPosition(notebook.workspaceType, notebook.workspaceId, notebook.parentPageId),
    prisma.scheduledMeeting.findMany({ where: { notebookId }, select: { id: true } }),
  ]);
  await prisma.$transaction([
    ...tabs.map((tab, index) =>
      prisma.page.update({
        where: { id: tab.id },
        data: { parentPageId: notebook.parentPageId, position: base + index, pinnedAt: null },
      }),
    ),
    prisma.scheduledMeeting.updateMany({ where: { notebookId }, data: { notebookId: null } }),
    prisma.page.update({ where: { id: notebookId }, data: retireData(notebook) }),
  ]);
  for (const m of meetings) await removeMeetingShares(m.id);
  return { moved: tabs.length };
}

/** Archive the notebook and its tabs at one instant, so Trash can restore the
 *  tabs that went with it and not ones trashed earlier. */
export async function trashNotebook(notebookId: string, actorId: string): Promise<void> {
  await loadManageableNotebook(notebookId, actorId);
  const subtree = await collectSubtree(notebookId);
  // The series keeps pointing at the notebook and its meeting shares stay: an
  // archived page grants nothing while in Trash, and a restore re-attaches
  // without anyone re-picking or re-sharing.
  await prisma.page.updateMany({
    where: { id: { in: [notebookId, ...subtree.ids] }, archivedAt: null },
    data: { archivedAt: new Date() },
  });
}
