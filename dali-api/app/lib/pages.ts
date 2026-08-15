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

// Idempotently ensures the lab-wide "Core" drive root exists: a top-level Lab
// Folder scoped to the Core group. scopeKind=Group cascades Core-only access to
// everything inside it (getPageAccess ancestry walk), and linkAccess=Restricted
// keeps it hidden from non-Core members on every list surface (same protection
// existing Restricted lab docs already rely on). Its systemKey both dedupes and
// stops api.documents.$id deleting it. Returns the folder id, or null if the
// Core GroupDefinition hasn't been provisioned yet (syncDefaultGroups seeds it).
export async function ensureCoreDriveRoot(createdById: string): Promise<{ id: string } | null> {
  const systemKey = "drive:core-root";
  const existing = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
  if (existing) return existing;

  const coreGroup = await prisma.groupDefinition.findUnique({
    where: { systemKey: "core" },
    select: { id: true },
  });
  if (!coreGroup) return null;

  try {
    const last = await prisma.page.findFirst({
      where: { workspaceType: "Lab", workspaceId: null, parentPageId: null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return await prisma.page.create({
      data: {
        workspaceType: "Lab",
        workspaceId: null,
        title: "Core",
        kind: "Folder",
        position: last ? last.position + 1 : 0,
        createdById,
        systemKey,
        scopeKind: "Group",
        scopeGroupId: coreGroup.id,
        scopePermission: "Edit",
        // Restricted: the scope grants Core; nobody reaches it via the lab link.
        linkAccess: "Restricted",
        linkPermission: "View",
      },
      select: { id: true },
    });
  } catch {
    const retry = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
    if (retry) return retry;
    throw new Error("Failed to ensure Core drive root");
  }
}

/**
 * Auto-provisioned "Hiring" Drive root — the scoped folder where all hiring
 * artifacts (application/challenge Forms, Rubrics, Confidentiality agreements)
 * live in Drive. Mirrors ensureCoreDriveRoot, but scoped to the dynamic
 * "hiring" group (Core + domain leads + cycle reviewers/interviewers) so anyone
 * with hiring access sees it and nobody else does. Idempotent via systemKey.
 *
 * Adoption (setting folderPageId = root for unplaced hiring artifacts) runs on
 * EVERY call — not just on first creation — so newly-created rubrics and
 * agreements are picked up on the next Drive visit without a separate backfill.
 * Each adoption query is a no-op once all rows are placed, so repeat calls are
 * cheap.
 */
export async function ensureHiringDriveRoot(createdById: string): Promise<{ id: string } | null> {
  const systemKey = "drive:hiring-root";

  // ── 1. Ensure the root exists ────────────────────────────────────────────
  let rootId: string;

  const existing = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
  if (existing) {
    rootId = existing.id;
  } else {
    // Self-contained: guarantee the dynamic hiring group exists (avoids a
    // circular import of groups.ts). Membership resolves via dynamicQuery.
    const hiringGroup = await prisma.groupDefinition.upsert({
      where: { systemKey: "hiring" },
      update: {},
      create: { name: "Hiring team", type: "Dynamic", dynamicQuery: "hiring", systemKey: "hiring" },
      select: { id: true },
    });

    try {
      const last = await prisma.page.findFirst({
        where: { workspaceType: "Lab", workspaceId: null, parentPageId: null },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const root = await prisma.page.create({
        data: {
          workspaceType: "Lab",
          workspaceId: null,
          title: "Hiring",
          kind: "Folder",
          position: last ? last.position + 1 : 0,
          createdById,
          systemKey,
          scopeKind: "Group",
          scopeGroupId: hiringGroup.id,
          scopePermission: "Edit",
          // Restricted: the scope grants the hiring team; nobody reaches it via
          // the lab link.
          linkAccess: "Restricted",
          linkPermission: "View",
        },
        select: { id: true },
      });
      rootId = root.id;
    } catch {
      const retry = await prisma.page.findUnique({ where: { systemKey }, select: { id: true } });
      if (retry) {
        rootId = retry.id;
      } else {
        throw new Error("Failed to ensure Hiring drive root");
      }
    }
  }

  // ── 2. Idempotent adoption — runs on every call ──────────────────────────
  // Each query is a no-op once all artifacts are placed, so this is cheap on
  // repeat calls. Best-effort: a failure here doesn't block the root return.
  try {
    // Forms: updateMany doesn't support to-many relation filters, so we
    // findMany first to get the scalar id list, then updateMany by id.
    const unplacedForms = await prisma.form.findMany({
      where: {
        folderPageId: null,
        OR: [
          { hiringCyclesAsApplicationForm: { some: {} } },
          { hiringDomainChallenges: { some: {} } },
        ],
      },
      select: { id: true },
    });
    if (unplacedForms.length > 0) {
      await prisma.form.updateMany({
        where: { id: { in: unplacedForms.map((f) => f.id) } },
        data: { folderPageId: rootId },
      });
    }

    // Rubrics: all hiring artifacts — scalar filter, so updateMany directly.
    await prisma.rubric.updateMany({
      where: { folderPageId: null },
      data: { folderPageId: rootId },
    });

    // SigningDocuments: only the Confidentiality kind belongs in the Hiring drive.
    await prisma.signingDocument.updateMany({
      where: { folderPageId: null, kind: "Confidentiality" },
      data: { folderPageId: rootId },
    });

    // EmailTemplates: all are global hiring artifacts — adopt all unplaced ones.
    await prisma.emailTemplate.updateMany({
      where: { folderPageId: null },
      data: { folderPageId: rootId },
    });
  } catch {
    // Adoption is best-effort; don't surface errors to the caller.
  }

  return { id: rootId };
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
