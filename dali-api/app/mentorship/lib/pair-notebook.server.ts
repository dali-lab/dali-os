import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { createNotebookTab, ensureMeetingNotebook } from "~/lib/pages";
import { resolveFilingFolder, singletonSlot } from "~/lib/drive-receivers.server";
import { pageDocName } from "~/collab/roomName";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { replaceCollabDocContent } from "~/collab/write";

export type PairKey = {
  mentorId: string;
  menteeId: string;
  projectId: string;
  termId: string;
  domainId: string;
};

export type MentorNoteRef = PairKey & {
  id: string;
  weekOf: Date;
  pageId: string | null;
  contentJson: unknown;
};

export function pairNotebookKey(pair: PairKey): string {
  return `mentorship:${pair.mentorId}:${pair.menteeId}:${pair.projectId}:${pair.termId}:${pair.domainId}`;
}

export function pairNotebookTitle(menteeName: string, mentorName: string, termCode: string): string {
  return `${menteeName} with ${mentorName} (${termCode})`;
}

export function weekTabTitle(weekOf: Date): string {
  const date = weekOf.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `Week of ${date}`;
}

export function legacyMentorNoteRoom(noteId: string): string {
  return `mentorNote:${noteId}:body`;
}

async function coreGroupId(): Promise<string> {
  const core = await prisma.groupDefinition.findUnique({ where: { systemKey: "core" }, select: { id: true } });
  if (!core) throw new Error("The Core group is missing; cannot share a mentor note");
  return core.id;
}

/** Edit is never inherited under the View-only Mentorship scope, so the author
 *  and Core are shared in explicitly on the notebook and on every tab. */
async function grantAuthorAndCoreEdit(pageId: string, mentorId: string, actorId: string): Promise<void> {
  const principals = [
    { principalType: "User" as const, principalId: mentorId },
    { principalType: "Group" as const, principalId: await coreGroupId() },
  ];
  await Promise.all(
    principals.map((p) =>
      prisma.pageShare.upsert({
        where: { pageId_principalType_principalId: { pageId, ...p } },
        update: {},
        create: { pageId, ...p, permission: "Edit", createdById: actorId },
      }),
    ),
  );
}

export async function ensurePairNotebook(input: PairKey & { actorId: string }): Promise<{ id: string }> {
  const key = pairNotebookKey(input);
  const existing = await prisma.page.findUnique({
    where: { notebookKey: key },
    select: { id: true, archivedAt: true },
  });
  if (existing && existing.archivedAt === null) return { id: existing.id };

  const [mentor, mentee, term, filing] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.mentorId }, select: { firstName: true, lastName: true } }),
    prisma.user.findUnique({ where: { id: input.menteeId }, select: { firstName: true, lastName: true } }),
    prisma.term.findUnique({ where: { id: input.termId }, select: { code: true } }),
    resolveFilingFolder(singletonSlot("Mentorship", "MentorNotebooks"), input.actorId),
  ]);

  const notebook = await ensureMeetingNotebook({
    key,
    title: pairNotebookTitle(
      (mentee && fullName(mentee)) || "Unknown mentee",
      (mentor && fullName(mentor)) || "Unknown mentor",
      term?.code ?? "?",
    ),
    createdById: input.actorId,
    workspaceType: "Lab",
    workspaceId: null,
    parentPageId: filing.folderId,
    restricted: true,
  });
  await grantAuthorAndCoreEdit(notebook.id, input.mentorId, input.actorId);
  return notebook;
}

/**
 * Give a note its tab in the pair notebook and move its body to the tab's room.
 * Idempotent: a note that already has a page returns it. An existing
 * `mentorNote:<id>:body` room is renamed to `doc:<pageId>:body` in the same
 * transaction that claims the note, so no history is rewritten; a note never
 * opened in collab gets a room materialised from `contentJson`.
 */
export async function ensureMentorNotePage(note: MentorNoteRef, actorId: string): Promise<{ pageId: string }> {
  if (note.pageId) return { pageId: note.pageId };

  const notebook = await ensurePairNotebook({ ...note, actorId });
  const tab = await createNotebookTab({
    notebookId: notebook.id,
    title: weekTabTitle(note.weekOf),
    createdById: actorId,
    meetingOccurrenceStart: note.weekOf,
  });

  const oldRoom = legacyMentorNoteRoom(note.id);
  const newRoom = pageDocName(tab.id);
  try {
    await grantAuthorAndCoreEdit(tab.id, note.mentorId, actorId);
    const hasRoom = (await prisma.collabDocument.findUnique({ where: { name: oldRoom }, select: { id: true } })) !== null;
    const blocks = hasRoom ? [] : ensureBlocks(note.contentJson);
    if (blocks.length > 0) await replaceCollabDocContent(newRoom, blocks, actorId);

    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.mentorNote.updateMany({
        where: { id: note.id, pageId: null },
        data: { pageId: tab.id },
      });
      if (claim.count === 0) return false;
      await tx.collabDocument.updateMany({ where: { name: oldRoom }, data: { name: newRoom } });
      await tx.collabDocumentVersion.updateMany({ where: { name: oldRoom }, data: { name: newRoom } });
      return true;
    });
    if (!claimed) {
      await prisma.page.delete({ where: { id: tab.id } });
      const winner = await prisma.mentorNote.findUniqueOrThrow({ where: { id: note.id }, select: { pageId: true } });
      return { pageId: winner.pageId! };
    }
  } catch (err) {
    await prisma.page.delete({ where: { id: tab.id } }).catch(() => undefined);
    throw err;
  }

  return { pageId: tab.id };
}

/** Deleting a note trashes its tab; SetNull alone would leave it live in the Drive. */
export async function archiveMentorNotePage(pageId: string | null): Promise<void> {
  if (!pageId) return;
  await prisma.page.updateMany({ where: { id: pageId, archivedAt: null }, data: { archivedAt: new Date() } });
}
