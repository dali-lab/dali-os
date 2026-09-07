import { prisma } from "~/lib/db";
import type { PageKind } from "~/generated/prisma/client";
import { ensureProcessFolder } from "~/lib/bindings.server";

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
  // Optional Lab folder to nest under (null = Lab top level). Lets a General
  // meeting file its note at a chosen Lab location instead of the root.
  parentPageId?: string | null;
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
      kind: "FreeForm",
      position,
      parentPageId,
      createdById: input.createdById,
      meetingNoteId: input.meetingNoteId ?? null,
      // Lab docs default to the communal shelf: everyone in the lab can edit.
      linkAccess: "LabMembers",
      linkPermission: "Edit",
    },
    select: { id: true },
  });
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
 *  workspace and return its id. Home for the offering's application form, so it
 *  lives WITH its offering (under the Education space). Backed by a
 *  ProcessFolderBinding (EducationOffering / <offeringId> / "forms") — a normal,
 *  editable folder, swappable from the offering settings. */
export async function ensureOfferingFormsFolder(
  offeringId: string,
  createdById: string,
): Promise<string> {
  return ensureProcessFolder({
    processType: "EducationOffering",
    processId: offeringId,
    purpose: "forms",
    createdById,
  });
}

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
