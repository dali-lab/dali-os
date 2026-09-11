// Process ↔ folder bindings.
//
// A "process" (a Project, an EducationOffering, a HiringCycle, or lab-wide Core
// governance) points at NORMAL Drive folders that receive its auto-filed
// artifacts — a project's meeting-notes folders, an offering's Forms folder,
// Core's Agreements folder, etc. This replaces the old `Page.systemKey`
// scaffolding (see the ProcessFolderBinding model in schema.prisma):
//   • the target folder is an ordinary Page (renameable / movable / shareable /
//     deletable), not a system-owned one;
//   • idempotency comes from the binding's unique (processType, processId,
//     purpose) key, not a systemKey;
//   • filing code + the settings UI read the binding to find "where does X go".
//
// The binding's folderPageId is onDelete:SetNull, so deleting the folder just
// clears the binding — `ensureProcessFolder` then transparently re-creates one.

import { prisma } from "~/lib/db";
import type { ProcessType, ScopeKind, SharePermission } from "~/generated/prisma/client";

export type { ProcessType };

// Singleton processId for lab-wide Core governance bindings — there is exactly
// one Core, so all its bindings share this constant (processId is non-null so
// the unique key dedupes; see the ProcessFolderBinding model).
export const CORE_PROCESS_ID = "core";

// A named slot a process type exposes. `purpose` is the stable key stored on the
// binding; `label` is shown in settings; `defaultTitle` names the folder we
// create when auto-provisioning. Slots are system-defined (they map to what
// actually auto-files) — users repoint/create/clear them, they don't invent new
// purposes.
export type FolderSlot = { purpose: string; label: string; defaultTitle: string };

export const FOLDER_SLOTS: Record<ProcessType, FolderSlot[]> = {
  Project: [
    { purpose: "meeting-notes-team", label: "Team meeting notes", defaultTitle: "Team meeting notes" },
    { purpose: "meeting-notes-partner", label: "Partner meeting notes", defaultTitle: "Partner meeting notes" },
  ],
  EducationOffering: [{ purpose: "forms", label: "Forms", defaultTitle: "Forms" }],
  HiringCycle: [
    { purpose: "forms", label: "Forms", defaultTitle: "Forms" },
    { purpose: "rubrics", label: "Rubrics", defaultTitle: "Rubrics" },
  ],
  Core: [
    { purpose: "meeting-notes", label: "Meeting notes", defaultTitle: "Meeting notes" },
    { purpose: "agreements", label: "Agreements", defaultTitle: "Agreements" },
    { purpose: "email-templates", label: "Email templates", defaultTitle: "Templates" },
    { purpose: "education-templates", label: "Education templates", defaultTitle: "Education Templates" },
    { purpose: "rubrics", label: "Rubrics", defaultTitle: "Rubrics" },
    { purpose: "application-templates", label: "Application templates", defaultTitle: "Application Templates" },
  ],
};

export function slotFor(processType: ProcessType, purpose: string): FolderSlot | undefined {
  return FOLDER_SLOTS[processType].find((s) => s.purpose === purpose);
}

// Where a process type's folders live, and the default access they get. Projects
// and offerings nest inside their own workspace (access follows the workspace).
// HiringCycle + Core folders live in the Lab workspace but default to a Group
// scope on the Core group — confidential, mirroring the old Core/Hiring roots,
// but now an ordinary editable share rather than a systemKey root.
function workspaceFor(
  processType: ProcessType,
  processId: string,
): { workspaceType: "Lab" | "Project" | "EducationOffering"; workspaceId: string | null; coreScoped: boolean } {
  switch (processType) {
    case "Project":
      return { workspaceType: "Project", workspaceId: processId, coreScoped: false };
    case "EducationOffering":
      return { workspaceType: "EducationOffering", workspaceId: processId, coreScoped: false };
    case "HiringCycle":
    case "Core":
      return { workspaceType: "Lab", workspaceId: null, coreScoped: true };
  }
}

async function coreGroupScope(): Promise<
  { scopeKind: ScopeKind; scopeGroupId: string; scopePermission: SharePermission } | null
> {
  const core = await prisma.groupDefinition.findUnique({
    where: { systemKey: "core" },
    select: { id: true },
  });
  return core ? { scopeKind: "Group", scopeGroupId: core.id, scopePermission: "Edit" } : null;
}

/** The bound folder id for a slot, or null if unbound or the folder is gone /
 *  archived. Read-only — never creates. Use when filing may land loose. */
export async function getBoundFolderId(
  processType: ProcessType,
  processId: string,
  purpose: string,
): Promise<string | null> {
  const binding = await prisma.processFolderBinding.findUnique({
    where: { processType_processId_purpose: { processType, processId, purpose } },
    select: { folderPage: { select: { id: true, archivedAt: true } } },
  });
  const folder = binding?.folderPage;
  return folder && folder.archivedAt == null ? folder.id : null;
}

/** All bindings for a process, keyed by purpose — for the settings UI. Includes
 *  archived-folder detection so the UI can show the ⚠ "folder deleted" state. */
export async function listBindings(
  processType: ProcessType,
  processId: string,
): Promise<Array<{ purpose: string; folderPageId: string | null; folderTitle: string | null; missing: boolean }>> {
  const rows = await prisma.processFolderBinding.findMany({
    where: { processType, processId },
    select: {
      purpose: true,
      folderPageId: true,
      folderPage: { select: { title: true, archivedAt: true } },
    },
  });
  return rows.map((r) => ({
    purpose: r.purpose,
    folderPageId: r.folderPage && r.folderPage.archivedAt == null ? r.folderPageId : null,
    folderTitle: r.folderPage && r.folderPage.archivedAt == null ? r.folderPage.title : null,
    // A binding row that exists but whose folder is gone/archived — show the
    // rebind affordance rather than pretending it's unset.
    missing: r.folderPageId != null && (r.folderPage == null || r.folderPage.archivedAt != null),
  }));
}

/** Point a slot at an existing folder (settings "Choose existing…"), or clear it
 *  (folderPageId null). Upserts the binding row. */
export async function setBinding(
  processType: ProcessType,
  processId: string,
  purpose: string,
  folderPageId: string | null,
  createdById: string,
): Promise<void> {
  await prisma.processFolderBinding.upsert({
    where: { processType_processId_purpose: { processType, processId, purpose } },
    update: { folderPageId },
    create: { processType, processId, purpose, folderPageId, createdById },
  });
}

/**
 * Idempotently ensure the folder bound to (processType, processId, purpose)
 * exists, creating a normal folder + recording the binding on first call.
 * Returns the folder id. Safe to call repeatedly and concurrently.
 *
 * `title` overrides the slot's default folder name (used when a caller wants a
 * per-instance name). `parentPageId` nests the folder; default is top level.
 */
export async function ensureProcessFolder(args: {
  processType: ProcessType;
  processId: string;
  purpose: string;
  createdById: string;
  title?: string;
  parentPageId?: string | null;
}): Promise<string> {
  const { processType, processId, purpose, createdById } = args;
  const parentPageId = args.parentPageId ?? null;

  // Fast path: a live bound folder already exists.
  const bound = await getBoundFolderId(processType, processId, purpose);
  if (bound) return bound;

  const slot = slotFor(processType, purpose);
  const title = args.title ?? slot?.defaultTitle ?? purpose;
  const { workspaceType, workspaceId, coreScoped } = workspaceFor(processType, processId);
  const scope = coreScoped ? await coreGroupScope() : null;

  // Reserve the slot atomically: the binding's unique key serializes concurrent
  // callers, so exactly one of them creates the folder. `create` throws on a
  // race (or if a stale row with a null/deleted folder already exists).
  try {
    await prisma.processFolderBinding.create({
      data: { processType, processId, purpose, folderPageId: null, createdById },
    });
  } catch {
    // A binding row already exists. Either another request is mid-create, or the
    // folder was deleted (folderPageId went null via SetNull). Re-read briefly,
    // then adopt the stale row by creating a replacement folder for it below.
    const existing = await getBoundFolderId(processType, processId, purpose);
    if (existing) return existing;
    return createFolderForExistingBinding({
      processType,
      processId,
      purpose,
      title,
      workspaceType,
      workspaceId,
      parentPageId,
      createdById,
      scope,
    });
  }

  return createFolderForExistingBinding({
    processType,
    processId,
    purpose,
    title,
    workspaceType,
    workspaceId,
    parentPageId,
    createdById,
    scope,
  });
}

// Create the folder for a binding row that already exists (reserved above, or a
// stale row whose folder was deleted) and point the binding at it.
async function createFolderForExistingBinding(args: {
  processType: ProcessType;
  processId: string;
  purpose: string;
  title: string;
  workspaceType: "Lab" | "Project" | "EducationOffering";
  workspaceId: string | null;
  parentPageId: string | null;
  createdById: string;
  scope: { scopeKind: ScopeKind; scopeGroupId: string; scopePermission: SharePermission } | null;
}): Promise<string> {
  const { processType, processId, purpose, title, workspaceType, workspaceId, parentPageId, createdById, scope } = args;

  // A concurrent caller may already have filled the folder in. Re-check first.
  const bound = await getBoundFolderId(processType, processId, purpose);
  if (bound) return bound;

  const last = await prisma.page.findFirst({
    where: { workspaceType, workspaceId, parentPageId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const folder = await prisma.page.create({
    data: {
      workspaceType,
      workspaceId,
      parentPageId,
      title,
      kind: "Folder",
      position: last ? last.position + 1 : 0,
      createdById,
      ...(scope
        ? {
            scopeKind: scope.scopeKind,
            scopeGroupId: scope.scopeGroupId,
            scopePermission: scope.scopePermission,
            // Restricted: the scope grants access; nobody reaches it via the lab link.
            linkAccess: "Restricted" as const,
            linkPermission: "View" as const,
          }
        : {}),
    },
    select: { id: true },
  });
  await prisma.processFolderBinding.update({
    where: { processType_processId_purpose: { processType, processId, purpose } },
    data: { folderPageId: folder.id },
  });
  return folder.id;
}
