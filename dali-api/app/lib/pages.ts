import { prisma } from "~/lib/db";
import type { PageKind } from "~/generated/prisma/client";
import { ensureProcessFolder, CORE_PROCESS_ID, LAB_PROCESS_ID } from "~/lib/bindings.server";

// Creates a Page in a project's workspace (the same Page model the project
// Overview/PRD/Documents-block use). Appends after the current max position
// among sibling pages under the same parent (top-level when parentPageId is
// null). Shared by the manual "add document"/"add folder" routes and any
// flow that auto-creates a project document (e.g. meeting notes).
export async function createProjectPage(input: {
  projectId: string;
  title: string;
  createdById: string;
  meetingNoteId?: string;
  meetingOccurrenceStart?: Date;
  meetingWhiteboardId?: string;
  notebookKey?: string;
  parentPageId?: string | null;
  kind?: PageKind;
}): Promise<{ id: string }> {
  const parentPageId = input.parentPageId ?? null;
  const last = await prisma.page.findFirst({
    where: { workspaceType: "Project", workspaceId: input.projectId, parentPageId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  return prisma.page.create({
    data: {
      workspaceType: "Project",
      workspaceId: input.projectId,
      title: input.title,
      kind: input.kind ?? "FreeForm",
      position,
      parentPageId,
      createdById: input.createdById,
      meetingNoteId: input.meetingNoteId ?? null,
      meetingOccurrenceStart: input.meetingOccurrenceStart ?? null,
      meetingWhiteboardId: input.meetingWhiteboardId ?? null,
      notebookKey: input.notebookKey ?? null,
    },
    select: { id: true },
  });
}

// Creates a top-level Page in the Lab workspace (workspaceId null — see
// Page.workspaceType comment in schema.prisma). Used for the meeting-note
// page of a project-less meetingType'd ScheduledMeeting (e.g. an all-lab
// SelfCheckIn event with no single owning project) — same shape as
// createProjectPage, just scoped to the Lab workspace instead of a project.
export async function createLabMeetingPage(input: {
  title: string;
  createdById: string;
  meetingNoteId?: string;
  meetingOccurrenceStart?: Date;
  meetingWhiteboardId?: string;
  notebookKey?: string;
  // FreeForm (note doc) by default; a meeting whiteboard passes Whiteboard.
  kind?: PageKind;
  // Optional Lab folder to nest under (null = Lab top level). Lets a General
  // meeting file its note at a chosen Lab location instead of the root.
  parentPageId?: string | null;
  // Filed inside a scoped drive (Core): start Restricted so the folder's scope
  // is the only thing granting access, rather than leaving a lab-wide link on a
  // page the ancestry walk happens to lock down.
  restricted?: boolean;
}): Promise<{ id: string }> {
  const parentPageId = input.parentPageId ?? null;
  const last = await prisma.page.findFirst({
    where: { workspaceType: "Lab", workspaceId: null, parentPageId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  return prisma.page.create({
    data: {
      workspaceType: "Lab",
      workspaceId: null,
      title: input.title,
      kind: input.kind ?? "FreeForm",
      position,
      parentPageId,
      createdById: input.createdById,
      meetingNoteId: input.meetingNoteId ?? null,
      meetingOccurrenceStart: input.meetingOccurrenceStart ?? null,
      meetingWhiteboardId: input.meetingWhiteboardId ?? null,
      notebookKey: input.notebookKey ?? null,
      // Lab docs default to the communal shelf: everyone in the lab can edit.
      linkAccess: input.restricted ? "Restricted" : "LabMembers",
      linkPermission: input.restricted ? "View" : "Edit",
    },
    select: { id: true },
  });
}

// ─── Meeting notebooks ───────────────────────────────────────────────────────

export type MeetingNotebookDestination = {
  workspaceType: "Lab" | "Project";
  workspaceId: string | null;
  /** The folder a new notebook is filed in. */
  parentPageId: string | null;
  /** Lab only: start Restricted (filed inside a scoped drive). */
  restricted?: boolean;
};

/**
 * Find or create the notebook with this key (see meeting-notebook.ts for what
 * the key means). The destination only places a NEW notebook: an existing one
 * stays wherever it has since been moved, and its notes follow it. A notebook
 * in the trash is retired from its key, so the next note starts a fresh one
 * rather than landing somewhere nobody can see.
 */
export async function ensureMeetingNotebook(
  input: { key: string; title: string; createdById: string } & MeetingNotebookDestination,
): Promise<{ id: string }> {
  const existing = await prisma.page.findUnique({
    where: { notebookKey: input.key },
    select: { id: true, archivedAt: true },
  });
  if (existing && existing.archivedAt === null) return { id: existing.id };
  if (existing) {
    await prisma.page.update({
      where: { id: existing.id },
      data: { notebookKey: `${input.key}#${existing.id}` },
    });
  }

  const fields = {
    title: input.title,
    createdById: input.createdById,
    parentPageId: input.parentPageId,
    notebookKey: input.key,
  };
  try {
    return input.workspaceType === "Project" && input.workspaceId
      ? await createProjectPage({ projectId: input.workspaceId, ...fields })
      : await createLabMeetingPage({ ...fields, restricted: input.restricted });
  } catch (err) {
    // Two notes for the same notebook created at once: the unique key lets one
    // create it, and the other files into that one.
    const raced = await prisma.page.findUnique({
      where: { notebookKey: input.key },
      select: { id: true },
    });
    if (raced) return raced;
    throw err;
  }
}

/** Where a notebook's tabs live: its own workspace and general access, so a
 *  note is reachable by exactly the people the notebook is. */
async function notebookTabPlacement(notebookId: string) {
  const notebook = await prisma.page.findUniqueOrThrow({
    where: { id: notebookId },
    select: { workspaceType: true, workspaceId: true, linkAccess: true, linkPermission: true },
  });
  return { ...notebook, parentPageId: notebookId };
}

/** Create one meeting's note as a tab of `notebookId`. */
export async function createNotebookTab(input: {
  notebookId: string;
  title: string;
  createdById: string;
  meetingNoteId: string;
  meetingOccurrenceStart: Date;
}): Promise<{ id: string }> {
  const placement = await notebookTabPlacement(input.notebookId);
  return prisma.page.create({
    data: {
      ...placement,
      title: input.title,
      createdById: input.createdById,
      meetingNoteId: input.meetingNoteId,
      meetingOccurrenceStart: input.meetingOccurrenceStart,
    },
    select: { id: true },
  });
}

/**
 * Re-file an existing note page as a tab of `notebookId`. Sharing that only
 * makes sense where the note used to live is reset, as on any move. The
 * notebook it left is trashed if that emptied it.
 */
export async function moveIntoNotebook(pageId: string, notebookId: string, title?: string): Promise<void> {
  const [placement, page] = await Promise.all([
    notebookTabPlacement(notebookId),
    prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { parentPageId: true, workspaceType: true, workspaceId: true, parent: { select: { notebookKey: true } } },
    }),
  ]);
  if (page.parentPageId === notebookId) return;
  const sameWorkspace =
    page.workspaceType === placement.workspaceType && page.workspaceId === placement.workspaceId;
  await prisma.page.update({
    where: { id: pageId },
    data: {
      ...placement,
      ...(title ? { title } : {}),
      pinnedAt: null,
      ...(sameWorkspace ? {} : { partnerVisible: false, publicVisible: false }),
    },
  });
  if (page.parentPageId && page.parent?.notebookKey) {
    const left = await prisma.page.count({ where: { parentPageId: page.parentPageId, archivedAt: null } });
    if (left === 0) {
      await prisma.page.update({ where: { id: page.parentPageId }, data: { archivedAt: new Date() } });
    }
  }
}

// ─── Nesting guards ──────────────────────────────────────────────────────────

// Maximum allowed depth in the page tree. Depth 0 = top-level; depth 6 = six
// levels of nesting. Capped here rather than the DB so the walk stays bounded.
export const MAX_PAGE_DEPTH = 6;

/**
 * Walk the parentPageId chain from `startId` (exclusive) toward the root,
 * returning the depth of `startId` itself (0 = root).  Returns -1 if any
 * ancestor is not found (broken chain) or if the chain would exceed
 * MAX_PAGE_DEPTH + 1 (avoids infinite loops on cyclic data).
 */
export async function pageDepth(startId: string): Promise<number> {
  let id: string | null = startId;
  let depth = 0;
  while (id !== null) {
    if (depth > MAX_PAGE_DEPTH + 1) return -1; // runaway guard
    const row: { parentPageId: string | null } | null = await prisma.page.findUnique({
      where: { id },
      select: { parentPageId: true },
    });
    if (!row) return -1;
    id = row.parentPageId;
    if (id !== null) depth++;
  }
  return depth;
}

/**
 * Every live descendant page id of `rootId` (exclusive), plus how many levels
 * deep they go (0 = no children). Iterative BFS, bounded by MAX_PAGE_DEPTH so
 * cyclic or broken parent chains can't loop.
 *
 * The subtree is the unit of work for anything that changes a folder's
 * standing: a move rewrites every descendant's workspace columns (and the
 * files filed against any folder in the set), and applying a folder scope
 * pushes Restricted general access down the same way. Both need the whole
 * tree — touching only the direct children leaves rows pointing into a
 * workspace or an audience they no longer belong to.
 */
export async function collectSubtree(
  rootId: string,
): Promise<{ ids: string[]; height: number }> {
  const out: string[] = [];
  let frontier = [rootId];
  let height = 0;
  for (let depth = 0; depth < MAX_PAGE_DEPTH && frontier.length > 0; depth++) {
    const children = await prisma.page.findMany({
      where: { parentPageId: { in: frontier }, archivedAt: null },
      select: { id: true },
    });
    const ids = children.map((c) => c.id).filter((id) => !out.includes(id) && id !== rootId);
    if (ids.length === 0) break;
    out.push(...ids);
    frontier = ids;
    height = depth + 1;
  }
  return { ids: out, height };
}

/**
 * Returns true if `ancestorId` appears anywhere in the ancestor chain of
 * `pageId`. Used to prevent cyclic moves: before setting page.parentPageId =
 * newParentId, check `isAncestor(newParentId, pageId)` and reject if true.
 * Bounded by MAX_PAGE_DEPTH + 2 to handle broken/cyclic chains gracefully.
 */
export async function isAncestorOf(
  ancestorId: string,
  pageId: string,
): Promise<boolean> {
  let id: string | null = pageId;
  let steps = 0;
  while (id !== null) {
    if (steps > MAX_PAGE_DEPTH + 2) return false; // broken/cyclic chain
    const row: { parentPageId: string | null } | null = await prisma.page.findUnique({
      where: { id },
      select: { parentPageId: true },
    });
    if (!row) return false;
    id = row.parentPageId;
    if (id === ancestorId) return true;
    steps++;
  }
  return false;
}

// Creates a Page in the Lab workspace (workspaceType=Lab, workspaceId=null —
// see Page.workspaceType comment in schema.prisma). Same shape as
// createProjectPage but for the lab-wide Documents area: supports Folder-kind
// containers and one level of nesting under a top-level folder. Appends after
// the current max position among siblings under the same parent.
export async function createLabPage(input: {
  title: string;
  createdById: string;
  parentPageId?: string | null;
  kind?: PageKind;
  /** Override the default communal general access. Pass "Restricted" for pages
   *  created inside a scoped drive (e.g. Core), so the scope governs access and
   *  the "everyone in the lab" link grant doesn't silently widen them. */
  restricted?: boolean;
}): Promise<{ id: string }> {
  const parentPageId = input.parentPageId ?? null;
  const last = await prisma.page.findFirst({
    where: { workspaceType: "Lab", workspaceId: null, parentPageId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  return prisma.page.create({
    data: {
      workspaceType: "Lab",
      workspaceId: null,
      title: input.title,
      kind: input.kind ?? "FreeForm",
      position,
      parentPageId,
      createdById: input.createdById,
      // Lab docs default to the communal shelf (everyone in the lab can edit);
      // pages inside a scoped drive start Restricted so the scope is authoritative.
      linkAccess: input.restricted ? "Restricted" : "LabMembers",
      linkPermission: input.restricted ? "View" : "Edit",
    },
    select: { id: true },
  });
}

/** Idempotently ensure the "Forms" folder inside an EducationOffering's
 *  workspace and return its id. Home for the offering's application form.
 *
 *  Fixed, not bound: an offering's Drive home is always Education ▸ <the
 *  offering> (the workspace itself is what the Education space renders as that
 *  folder), so there is nothing to configure and no settings section for it.
 *  The folder page stays an ordinary one — renameable, shareable — and is
 *  re-created here if someone deletes it.
 *
 *  Concurrency: the offering row is locked for the find-or-create so two
 *  simultaneous "create the application form" clicks can't leave two Forms
 *  folders behind. */
export async function ensureOfferingFormsFolder(
  offeringId: string,
  createdById: string,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EducationOffering" WHERE id = ${offeringId} FOR UPDATE`;
    const existing = await tx.page.findFirst({
      where: {
        workspaceType: "EducationOffering",
        workspaceId: offeringId,
        parentPageId: null,
        kind: "Folder",
        title: OFFERING_FORMS_FOLDER_TITLE,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    const last = await tx.page.findFirst({
      where: { workspaceType: "EducationOffering", workspaceId: offeringId, parentPageId: null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const folder = await tx.page.create({
      data: {
        workspaceType: "EducationOffering",
        workspaceId: offeringId,
        parentPageId: null,
        title: OFFERING_FORMS_FOLDER_TITLE,
        kind: "Folder",
        position: last ? last.position + 1 : 0,
        createdById,
      },
      select: { id: true },
    });
    return folder.id;
  });
}

const OFFERING_FORMS_FOLDER_TITLE = "Forms";

export type MeetingNotesFolderKind = "Team" | "Partner";

// Idempotently ensures a project's default "Team meeting notes" / "Partner
// meeting notes" folder exists, returning it. Backed by a ProcessFolderBinding
// (Project / <projectId> / "meeting-notes-{team,partner}") — an ordinary,
// editable folder swappable from the project settings, not a systemKey root.
// Safe to call repeatedly (idempotent via the binding's unique key); cheap
// enough to call from the Documents block loader so existing projects backfill
// on first view.
export async function ensureMeetingNotesFolder(
  projectId: string,
  kind: MeetingNotesFolderKind,
  createdById: string,
): Promise<{ id: string }> {
  const purpose = kind === "Team" ? "meeting-notes-team" : "meeting-notes-partner";
  const id = await ensureProcessFolder({
    processType: "Project",
    processId: projectId,
    purpose,
    createdById,
  });
  return { id };
}

/** Idempotently ensure Core's "Meeting notes" folder — the Core drive's own
 *  equivalent of a project's Team/Partner meeting-notes folders, so a Core
 *  meeting's note lands somewhere Core-only instead of loose in the Lab drive.
 *  Backed by a ProcessFolderBinding (Core / "meeting-notes"): an ordinary Lab
 *  folder shared with the Core group (scopeKind=Group, applied by
 *  ensureProcessFolder), which the Core drive space surfaces. Core can rename,
 *  move, or repoint it from settings. Nullable return kept for the caller's
 *  Lab-root fallback, though the binding path always yields a folder now. */
export async function ensureCoreMeetingNotesFolder(createdById: string): Promise<string | null> {
  return ensureProcessFolder({
    processType: "Core",
    processId: CORE_PROCESS_ID,
    purpose: "meeting-notes",
    createdById,
  });
}

/** Idempotently ensure the Lab drive's own "Meeting notes" folder — the open
 *  counterpart of Core's, and the home for every meeting note that belongs to
 *  no project and isn't Core's. Those used to land loose at the Lab root, where
 *  a note titled just its date is effectively unfindable a week later.
 *  Backed by a ProcessFolderBinding (Lab / "meeting-notes"): an ordinary Lab
 *  folder on the communal shelf (no group scope — everyone in the lab can see
 *  and edit it), so it can be renamed, moved, or repointed like any other. */
export async function ensureLabMeetingNotesFolder(createdById: string): Promise<string | null> {
  return ensureProcessFolder({
    processType: "Lab",
    processId: LAB_PROCESS_ID,
    purpose: "meeting-notes",
    createdById,
  });
}

// The page behind a project's public write-up — the body dali.website renders
// under the showcase card. Created on demand from the Public view (not on
// mere page load: a project nobody intends to showcase shouldn't accrue an
// empty document), and marked publicVisible so the public API picks it up
// without a second step.
//
// It's an ordinary project page, so it also appears in the Documents block and
// can be edited from there. The link is recorded on Project.publicWriteupPageId
// (single-artifact FK, same pattern as overviewPageId) — no systemKey — with
// onDelete SetNull so deleting the page just clears the link.
export async function ensurePublicWriteupPage(
  projectId: string,
  createdById: string,
): Promise<{ id: string }> {
  // Reuse the recorded write-up page if it still exists and isn't archived.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { publicWriteupPage: { select: { id: true, archivedAt: true } } },
  });
  if (project?.publicWriteupPage && project.publicWriteupPage.archivedAt == null) {
    return { id: project.publicWriteupPage.id };
  }

  // A team may already have nominated some other page via the Documents globe
  // toggle. Respect that rather than creating a second public page — the public
  // API takes the lowest-position publicVisible page, so creating one here could
  // silently outrank the page they chose. Record it as the write-up page too.
  const existingPublic = await prisma.page.findFirst({
    where: {
      workspaceType: "Project",
      workspaceId: projectId,
      archivedAt: null,
      publicVisible: true,
    },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (existingPublic) {
    await prisma.project.update({
      where: { id: projectId },
      data: { publicWriteupPageId: existingPublic.id },
    });
    return existingPublic;
  }

  const last = await prisma.page.findFirst({
    where: { workspaceType: "Project", workspaceId: projectId, parentPageId: null },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const page = await prisma.page.create({
    data: {
      workspaceType: "Project",
      workspaceId: projectId,
      title: "Public write-up",
      kind: "FreeForm",
      position: last ? last.position + 1 : 0,
      createdById,
      publicVisible: true,
    },
    select: { id: true },
  });
  await prisma.project.update({
    where: { id: projectId },
    data: { publicWriteupPageId: page.id },
  });
  return page;
}
