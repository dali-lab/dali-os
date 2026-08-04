import { prisma } from "~/lib/db";
import type { PageKind } from "~/generated/prisma/client";

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
}): Promise<{ id: string }> {
  const last = await prisma.page.findFirst({
    where: { workspaceType: "Lab", workspaceId: null, parentPageId: null },
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
      createdById: input.createdById,
      meetingNoteId: input.meetingNoteId ?? null,
      // Lab docs default to the communal shelf: everyone in the lab can edit.
      linkAccess: "LabMembers",
      linkPermission: "Edit",
    },
    select: { id: true },
  });
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
      // Lab docs default to the communal shelf: everyone in the lab can edit.
      linkAccess: "LabMembers",
      linkPermission: "Edit",
    },
    select: { id: true },
  });
}

export type MeetingNotesFolderKind = "Team" | "Partner";

const MEETING_NOTES_FOLDER_TITLE: Record<MeetingNotesFolderKind, string> = {
  Team: "Team meeting notes",
  Partner: "Partner meeting notes",
};

// Idempotently ensures a project's default "Team meeting notes" / "Partner
// meeting notes" folder exists, creating it (top-level, Folder-kind,
// systemKey-marked so api.documents.$id.ts refuses to delete it) on first
// call. Safe to call repeatedly — cheap enough to call from the Documents
// block loader so existing projects backfill their folders on first view
// rather than needing a separate migration script (same pattern as
// ensureProjectGroup in ~/lib/groups.ts).
export async function ensureMeetingNotesFolder(
  projectId: string,
  kind: MeetingNotesFolderKind,
  createdById: string,
): Promise<{ id: string }> {
  const systemKey = `project:${projectId}:${kind.toLowerCase()}-meeting-notes`;
  const existing = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
  if (existing) return existing;

  try {
    const last = await prisma.page.findFirst({
      where: { workspaceType: "Project", workspaceId: projectId, parentPageId: null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const position = last ? last.position + 1 : 0;
    return await prisma.page.create({
      data: {
        workspaceType: "Project",
        workspaceId: projectId,
        title: MEETING_NOTES_FOLDER_TITLE[kind],
        kind: "Folder",
        position,
        createdById,
        systemKey,
      },
      select: { id: true },
    });
  } catch {
    // Unique-constraint race: another request created it concurrently.
    const retry = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
    if (retry) return retry;
    throw new Error(`Failed to ensure meeting notes folder for project ${projectId}`);
  }
}

// The page behind a project's public write-up — the body dali.website renders
// under the showcase card. Created on demand from the Public view (not on
// mere page load: a project nobody intends to showcase shouldn't accrue an
// empty document), and marked publicVisible so the public API picks it up
// without a second step.
//
// It's an ordinary project page, so it also appears in the Documents block
// and can be edited from there. The systemKey both makes this ensure-create
// idempotent and stops api.documents.$id.ts deleting it out from under the
// public site.
export async function ensurePublicWriteupPage(
  projectId: string,
  createdById: string,
): Promise<{ id: string }> {
  // A team may already have nominated some other page via the Documents
  // globe toggle. Respect that rather than creating a second public page —
  // the public API takes the lowest-position publicVisible page, so creating
  // one here could silently outrank the page they chose.
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
  if (existingPublic) return existingPublic;

  const systemKey = `project:${projectId}:public-writeup`;
  // Un-archive rather than duplicate: the systemKey is unique, so a
  // previously archived write-up would otherwise block creation forever.
  const existing = await prisma.page.findUnique({
    where: { systemKey },
    select: { id: true },
  });
  if (existing) {
    await prisma.page.update({
      where: { id: existing.id },
      data: { publicVisible: true, archivedAt: null },
    });
    return existing;
  }

  try {
    const last = await prisma.page.findFirst({
      where: { workspaceType: "Project", workspaceId: projectId, parentPageId: null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return await prisma.page.create({
      data: {
        workspaceType: "Project",
        workspaceId: projectId,
        title: "Public write-up",
        kind: "FreeForm",
        position: last ? last.position + 1 : 0,
        createdById,
        systemKey,
        publicVisible: true,
      },
      select: { id: true },
    });
  } catch {
    // Unique-constraint race: another request created it concurrently.
    const retry = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
    if (retry) return retry;
    throw new Error(`Failed to ensure public write-up page for project ${projectId}`);
  }
}
