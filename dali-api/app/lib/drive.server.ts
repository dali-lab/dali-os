// Unified Drive tree data layer — Wave 3 (partial) of the drive-consolidation
// feature flag work. This module is behind the flag; callers must gate.
//
// Provides a single `loadDriveScope` function that returns every item a viewer
// can see in a given scope (Lab or a specific project) normalised to a
// `DriveItem` discriminated union — folders, docs, files, and forms all share
// the same shape so the tree UI can treat them uniformly.
//
// ACCESS GUARANTEE: this loader NEVER widens access relative to the pre-unified
// surfaces. It enforces the exact same per-type visibility rules that existed
// before the Drive unification:
//   • Folders / docs: filtered through the existing `getPageAccess` ancestry
//     logic (or the equivalent workspace-scoped query used by the docs hub).
//   • Files:          only visible if the viewer can already see that project's
//     docs — we reuse the project-id list derived from the same project query
//     the docs hub uses, so a file in project X is visible iff the viewer is
//     Core or staffed on project X.
//   • Forms:          only returned when the caller passes `canViewForms: true`
//     (the same `canViewForms` boolean from `~/lib/roles`). `folderPageId` is
//     ORGANISATION only — it does not change who can see or fill a form.

import { prisma } from "~/lib/db";
import { getPageAccess, getPageAccessBulk } from "~/lib/pageAccess.server";
import { canViewFile } from "~/lib/fileAccess.server";
import type { Prisma } from "~/generated/prisma/client";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Scope definition: `{ kind: "Lab" }` for the lab-wide tree;
 *  `{ kind: "Project", projectId: string }` for a single project;
 *  `{ kind: "Member" }` for the viewer's own private drive (personal notes);
 *  `{ kind: "EducationOffering", offeringId: string }` for one offering's workspace. */
export type DriveScope =
  | { kind: "Lab" }
  | { kind: "Project"; projectId: string }
  | { kind: "Member" }
  | { kind: "EducationOffering"; offeringId: string };

/** Normalised item shape used by the unified tree UI. */
export type DriveItem =
  | {
      type: "folder";
      id: string;
      title: string;
      /** `parentPageId` for pages, null when top-level. */
      parentFolderId: string | null;
      iconEmoji: string | null;
      updatedAt: Date;
      href: string;
      /** File size in bytes (files only; null elsewhere). Drives the Size column. */
      sizeBytes?: number | null;
      /** Whether the viewer has favorited this item (pages only). */
      favorited?: boolean;
      /**
       * Signal ②: process that owns or binds this item (derived at load time in
       * Wave 2 — e.g. "Hiring 26F", "Confidentiality"). Unpopulated in Wave 0.
       */
      linkedProcess?: { label: string; href: string } | null;
      /**
       * Whether this page is shared with the project's partner org(s).
       * Only populated in project-scoped Drive loads; null/undefined elsewhere.
       */
      partnerVisible?: boolean | null;
    }
  | {
      type: "doc";
      /** True when the underlying Page.kind is Whiteboard — drives the Drive
       *  icon and the /whiteboard/:id open href (vs the /documents/:id editor). */
      isWhiteboard?: boolean;
      id: string;
      title: string;
      parentFolderId: string | null;
      iconEmoji: string | null;
      updatedAt: Date;
      href: string;
      /** File size in bytes (files only; null elsewhere). Drives the Size column. */
      sizeBytes?: number | null;
      /** Whether the viewer has favorited this item (pages only). */
      favorited?: boolean;
      /**
       * Signal ②: process that owns or binds this item (derived at load time in
       * Wave 2 — e.g. "Hiring 26F", "Confidentiality"). Unpopulated in Wave 0.
       */
      linkedProcess?: { label: string; href: string } | null;
      /**
       * Whether this page is shared with the project's partner org(s).
       * Only populated in project-scoped Drive loads; null/undefined elsewhere.
       */
      partnerVisible?: boolean | null;
    }
  | {
      type: "file";
      id: string;
      title: string;
      /** `folderPageId` — null when unplaced. */
      parentFolderId: string | null;
      iconEmoji: null; // files have no emoji; callers use a fixed icon
      updatedAt: Date;
      href: string;
      /** File size in bytes (files only; null elsewhere). Drives the Size column. */
      sizeBytes?: number | null;
      /** Whether the viewer has favorited this item (pages only). */
      favorited?: boolean;
      /**
       * Signal ②: process that owns or binds this item (derived at load time in
       * Wave 2 — e.g. "Hiring 26F", "Confidentiality"). Unpopulated in Wave 0.
       */
      linkedProcess?: { label: string; href: string } | null;
      /**
       * Whether this file is shared with the project's partner org(s).
       * Only populated in project-scoped Drive loads; null/undefined elsewhere.
       */
      partnerVisible?: boolean | null;
    }
  | {
      type: "form";
      id: string;
      title: string;
      /** `folderPageId` — null when unplaced. */
      parentFolderId: string | null;
      iconEmoji: null; // forms have no emoji; callers use a fixed icon
      updatedAt: Date;
      href: string;
      /** File size in bytes (files only; null elsewhere). Drives the Size column. */
      sizeBytes?: number | null;
      /** Whether the viewer has favorited this item (pages only). */
      favorited?: boolean;
      /**
       * Signal ②: process that owns or binds this item (derived at load time in
       * Wave 2 — e.g. "Hiring 26F", "Confidentiality"). Unpopulated in Wave 0.
       */
      linkedProcess?: { label: string; href: string } | null;
    }
  | {
      type: "agreement";
      id: string;
      title: string;
      /** `folderPageId` — null when unplaced (renders at Lab top level). */
      parentFolderId: string | null;
      iconEmoji: null;
      updatedAt: Date;
      href: string;
      /** File size in bytes (files only; null elsewhere). Drives the Size column. */
      sizeBytes?: number | null;
      /** Whether the viewer has favorited this item (pages only). */
      favorited?: boolean;
      /**
       * Signal ②: process that owns or binds this item (derived at load time in
       * Wave 2 — e.g. "Hiring 26F", "Confidentiality"). Unpopulated in Wave 0.
       */
      linkedProcess?: { label: string; href: string } | null;
    }
  | {
      type: "rubric";
      id: string;
      title: string;
      /** `folderPageId` — null when unplaced. */
      parentFolderId: string | null;
      iconEmoji: null; // rubrics have no emoji; callers use a fixed icon
      updatedAt: Date;
      href: string;
      /** File size in bytes (files only; null elsewhere). Drives the Size column. */
      sizeBytes?: number | null;
      /** Whether the viewer has favorited this item (pages only). */
      favorited?: boolean;
      /**
       * Signal ②: process that owns or binds this item (derived at load time in
       * Wave 2 — e.g. "Hiring 26F", "Confidentiality"). Unpopulated in Wave 0.
       */
      linkedProcess?: { label: string; href: string } | null;
    };

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Drop the rows a scoped folder hides from this viewer.
 *
 * Project and offering drives inherit access from their workspace, so the
 * expensive per-page walk is pointless unless somebody has actually scoped a
 * folder inside one (the "Folder access" control in the Share dialog). When
 * nothing is scoped — the overwhelmingly common case — this returns the rows
 * untouched without a single extra query, which is what keeps these loaders as
 * cheap as they were. When something IS scoped, every row goes through
 * getPageAccessBulk, because the scope cascades to everything beneath it.
 */
async function filterScoped<T extends { id: string; scopeKind?: unknown }>(
  rows: T[],
  userSub: string,
  request?: Request,
): Promise<T[]> {
  if (!rows.some((r) => r.scopeKind != null)) return rows;
  const access = await getPageAccessBulk(userSub, rows as unknown as Parameters<typeof getPageAccessBulk>[1], request);
  return rows.filter((r) => access.get(r.id)?.canView);
}

/** Load pages (folders + docs) for a Lab-scope drive, filtering each through
 *  getPageAccess so the caller gets exactly what the viewer may view. */
async function loadLabPages(userSub: string, request?: Request): Promise<DriveItem[]> {
  const rows = await prisma.page.findMany({
    where: {
      workspaceType: "Lab",
      workspaceId: null,
      archivedAt: null,
      kind: { in: ["Folder", "FreeForm", "Structured", "Whiteboard"] },
    },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      kind: true,
      parentPageId: true,
      iconEmoji: true,
      updatedAt: true,
      // Fields getPageAccess needs when passed as PageShape
      workspaceType: true,
      workspaceId: true,
      archivedAt: true,
      createdById: true,
      partnerVisible: true,
      profileVisible: true,
      labListing: true,
      linkAccess: true,
      linkPermission: true,
      scopeKind: true,
      scopeGroupId: true,
      scopePermission: true,
    },
  });

  // One batched pageShare query instead of N individual ones.
  const accessMap = await getPageAccessBulk(userSub, rows, request);

  const items: DriveItem[] = [];
  for (const row of rows) {
    const access = accessMap.get(row.id);
    if (!access?.canView) continue;
    items.push(
      row.kind === "Folder"
        ? {
            type: "folder",
            id: row.id,
            title: row.title,
            parentFolderId: row.parentPageId,
            iconEmoji: row.iconEmoji,
            updatedAt: row.updatedAt,
            href: `/documents/${row.id}`,
          }
        : {
            type: "doc",
            isWhiteboard: row.kind === "Whiteboard",
            id: row.id,
            title: row.title,
            parentFolderId: row.parentPageId,
            iconEmoji: row.iconEmoji,
            updatedAt: row.updatedAt,
            href:
              row.kind === "Whiteboard"
                ? `/whiteboard/${row.id}`
                : `/documents/${row.id}`,
          },
    );
  }
  return items;
}

/** Load pages for a project-scope drive. Project membership (Core or staffed)
 *  already gates the project query upstream, and every page in a visible
 *  project is viewable by project members — so the per-page getPageAccess walk
 *  is skipped unless the workspace actually contains an explicitly scoped
 *  folder. Someone can scope a project folder to "Only people you add" from
 *  the Share dialog, and without the check the Drive kept listing its contents
 *  to the whole team even though the folder itself denies them. A workspace
 *  with no scoped folder (the common case) pays one cheap existence query and
 *  behaves exactly as before. */
/**
 * Select shape for `loadProjectPages`, exported so the project route loader
 * can widen its own Stage 2 `pageRows` query (by spreading this object) and
 * pass the result back in as `preloaded` — one query instead of two for the
 * same project on every project page load.
 */
export const PROJECT_PAGE_SELECT = {
  id: true,
  title: true,
  kind: true,
  parentPageId: true,
  iconEmoji: true,
  updatedAt: true,
  partnerVisible: true,
  // Only read by the scoped branch below; cheap to carry either way, and it
  // saves getPageAccessBulk re-fetching every row.
  workspaceType: true,
  workspaceId: true,
  archivedAt: true,
  createdById: true,
  profileVisible: true,
  labListing: true,
  linkAccess: true,
  linkPermission: true,
  scopeKind: true,
  scopeGroupId: true,
  scopePermission: true,
} as const;

export type ProjectPageRow = Prisma.PageGetPayload<{ select: typeof PROJECT_PAGE_SELECT }>;

async function loadProjectPages(
  projectId: string,
  userSub: string,
  request?: Request,
  preloaded?: ProjectPageRow[],
): Promise<DriveItem[]> {
  const rows =
    preloaded ??
    (await prisma.page.findMany({
      where: {
        workspaceType: "Project",
        workspaceId: projectId,
        archivedAt: null,
        kind: { in: ["Folder", "FreeForm", "Structured", "Whiteboard"] },
      },
      orderBy: { position: "asc" },
      select: PROJECT_PAGE_SELECT,
    }));

  const visible = await filterScoped(rows, userSub, request);

  return visible.map((row) =>
    row.kind === "Folder"
      ? {
          type: "folder",
          id: row.id,
          title: row.title,
          parentFolderId: row.parentPageId,
          iconEmoji: row.iconEmoji,
          updatedAt: row.updatedAt,
          href: `/documents/${row.id}`,
          partnerVisible: row.partnerVisible,
        }
      : {
          type: "doc",
          isWhiteboard: row.kind === "Whiteboard",
          id: row.id,
          title: row.title,
          parentFolderId: row.parentPageId,
          iconEmoji: row.iconEmoji,
          updatedAt: row.updatedAt,
          href:
            row.kind === "Whiteboard"
              ? `/whiteboard/${row.id}`
              : `/documents/${row.id}`,
          partnerVisible: row.partnerVisible,
        },
  );
}

/** Load pages (folders + docs) for a single EducationOffering workspace.
 *  Access is inherited from offering membership: the caller must already have
 *  verified the viewer is enrolled/instructor/Core before calling this. Every
 *  page in a visible offering is viewable by that audience — mirrors the project
 *  scope which trusts the upstream membership gate. */
/** Load uploaded files (ProjectFile rows) scoped to an EducationOffering. */
async function loadEducationFiles(offeringId: string): Promise<DriveItem[]> {
  const rows = await prisma.projectFile.findMany({
    where: {
      workspaceType: "EducationOffering",
      workspaceId: offeringId,
      archivedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      folderPageId: true,
      updatedAt: true,
      currentVersion: { select: { sizeBytes: true } },
    },
  });
  return rows.map((f) => ({
    type: "file" as const,
    id: f.id,
    title: f.title,
    parentFolderId: f.folderPageId,
    iconEmoji: null,
    updatedAt: f.updatedAt,
    href: `/documents/file/${f.id}`,
    sizeBytes: f.currentVersion?.sizeBytes ?? null,
  }));
}

async function loadEducationPages(
  offeringId: string,
  userSub: string,
  request?: Request,
): Promise<DriveItem[]> {
  const rows = await prisma.page.findMany({
    where: {
      workspaceType: "EducationOffering",
      workspaceId: offeringId,
      archivedAt: null,
      kind: { in: ["Folder", "FreeForm", "Structured", "Whiteboard"] },
    },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      kind: true,
      parentPageId: true,
      iconEmoji: true,
      updatedAt: true,
      // See loadProjectPages: only used when the workspace holds a scoped folder.
      workspaceType: true,
      workspaceId: true,
      archivedAt: true,
      createdById: true,
      partnerVisible: true,
      profileVisible: true,
      labListing: true,
      linkAccess: true,
      linkPermission: true,
      scopeKind: true,
      scopeGroupId: true,
      scopePermission: true,
    },
  });

  const visible = await filterScoped(rows, userSub, request);

  return visible.map((row) =>
    row.kind === "Folder"
      ? {
          type: "folder",
          id: row.id,
          title: row.title,
          parentFolderId: row.parentPageId,
          iconEmoji: row.iconEmoji,
          updatedAt: row.updatedAt,
          href: `/documents/${row.id}`,
        }
      : {
          type: "doc",
          isWhiteboard: row.kind === "Whiteboard",
          id: row.id,
          title: row.title,
          parentFolderId: row.parentPageId,
          iconEmoji: row.iconEmoji,
          updatedAt: row.updatedAt,
          href:
            row.kind === "Whiteboard"
              ? `/whiteboard/${row.id}`
              : `/documents/${row.id}`,
        },
  );
}

/** Load pages (folders + docs) for the viewer's own Member drive — their
 *  personal notes. Owner-only by construction: every row is workspaceId=userSub,
 *  and getPageAccess grants the owner FULL, so no per-page filtering is needed. */
async function loadMemberPages(userSub: string): Promise<DriveItem[]> {
  const rows = await prisma.page.findMany({
    where: {
      workspaceType: "Member",
      workspaceId: userSub,
      archivedAt: null,
      kind: { in: ["Folder", "FreeForm", "Structured", "Whiteboard"] },
    },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      kind: true,
      parentPageId: true,
      iconEmoji: true,
      updatedAt: true,
    },
  });

  return rows.map((row) =>
    row.kind === "Folder"
      ? {
          type: "folder",
          id: row.id,
          title: row.title,
          parentFolderId: row.parentPageId,
          iconEmoji: row.iconEmoji,
          updatedAt: row.updatedAt,
          href: `/documents/${row.id}`,
        }
      : {
          type: "doc",
          isWhiteboard: row.kind === "Whiteboard",
          id: row.id,
          title: row.title,
          parentFolderId: row.parentPageId,
          iconEmoji: row.iconEmoji,
          updatedAt: row.updatedAt,
          href:
            row.kind === "Whiteboard"
              ? `/whiteboard/${row.id}`
              : `/documents/${row.id}`,
        },
  );
}

/** Load the viewer's own My Drive files (Member workspace, owner-scoped). */
async function loadMemberFiles(userSub: string): Promise<DriveItem[]> {
  const rows = await prisma.projectFile.findMany({
    where: { workspaceType: "Member", workspaceId: userSub, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      folderPageId: true,
      updatedAt: true,
      currentVersion: { select: { sizeBytes: true } },
    },
  });
  return rows.map((f) => ({
    type: "file" as const,
    id: f.id,
    title: f.title,
    parentFolderId: f.folderPageId,
    iconEmoji: null,
    updatedAt: f.updatedAt,
    href: `/documents/file/${f.id}`,
    sizeBytes: f.currentVersion?.sizeBytes ?? null,
  }));
}

/** Load lab-scoped files. Visible to all lab members, EXCEPT files placed inside
 *  a scoped folder (e.g. Core), which are filtered to viewers with access to
 *  that folder via canViewFile — so a Core file doesn't leak to every lab member.
 *
 *  NO-WIDENING GUARANTEE: lab files → lab members only; project files →
 *  project-member set only. These two sets never cross: a lab file has a null
 *  projectId and workspaceType='Lab'; a project file has a non-null projectId
 *  and null workspaceType. The loader never returns project files in the Lab
 *  scope (loadLabFiles) nor lab files in the project scope (loadFiles). */
async function loadLabFiles(userSub: string, request?: Request): Promise<DriveItem[]> {
  const rows = await prisma.projectFile.findMany({
    where: { workspaceType: "Lab", archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      folderPageId: true,
      updatedAt: true,
      currentVersion: { select: { sizeBytes: true } },
    },
  });
  // Memoize canViewFile per distinct folderPageId: all files sharing the same
  // folderPageId see the same ancestor walk result, so we compute it once.
  const folderAccessCache = new Map<string, Promise<boolean>>();
  const canViewFolder = (folderId: string): Promise<boolean> => {
    let p = folderAccessCache.get(folderId);
    if (!p) {
      p = canViewFile(userSub, { workspaceType: "Lab", workspaceId: null, folderPageId: folderId }, request);
      folderAccessCache.set(folderId, p);
    }
    return p;
  };

  const out: DriveItem[] = [];
  for (const f of rows) {
    // Fast path: files at the lab root (no folder) skip the access check.
    if (f.folderPageId && !(await canViewFolder(f.folderPageId))) {
      continue;
    }
    out.push({
      type: "file",
      id: f.id,
      title: f.title,
      parentFolderId: f.folderPageId,
      iconEmoji: null,
      updatedAt: f.updatedAt,
      href: `/documents/file/${f.id}`,
      sizeBytes: f.currentVersion?.sizeBytes ?? null,
    });
  }
  return out;
}

/** Load files for the given project IDs. Access is inherited from the project:
 *  the caller's `projectIds` list must already be scoped to projects the viewer
 *  can see (same query the docs hub uses) — EXCEPT for files sitting inside a
 *  scoped folder, which follow the folder instead, the same way loadLabFiles
 *  handles Core files. Without that, scoping a project folder to "Only people
 *  you add" hid the folder but kept listing the files inside it to the whole
 *  team. The per-file check only runs for files actually in a scoped folder. */
/**
 * Select shape for `loadFiles`, exported so the project route loader can
 * widen its own Stage 2 `fileRows` query (by spreading this object) and pass
 * the result back in as `preloaded` — same rationale as `PROJECT_PAGE_SELECT`.
 */
export const PROJECT_FILE_SELECT = {
  id: true,
  title: true,
  folderPageId: true,
  projectId: true,
  updatedAt: true,
  partnerVisible: true,
  currentVersion: { select: { sizeBytes: true } },
} as const;

export type ProjectFileRow = Prisma.ProjectFileGetPayload<{ select: typeof PROJECT_FILE_SELECT }>;

async function loadFiles(
  projectIds: string[],
  userSub: string,
  request?: Request,
  preloaded?: ProjectFileRow[],
): Promise<DriveItem[]> {
  if (projectIds.length === 0) return [];
  const rows =
    preloaded ??
    (await prisma.projectFile.findMany({
      where: { projectId: { in: projectIds }, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: PROJECT_FILE_SELECT,
    }));

  // Memoised per folder: every file in the same folder gets the same answer,
  // and a file at the project root skips the walk entirely.
  const folderAccess = new Map<string, Promise<boolean>>();
  const visible: typeof rows = [];
  for (const f of rows) {
    if (!f.folderPageId) {
      visible.push(f);
      continue;
    }
    let allowed = folderAccess.get(f.folderPageId);
    if (!allowed) {
      allowed = canViewFile(userSub, { projectId: f.projectId, folderPageId: f.folderPageId }, request);
      folderAccess.set(f.folderPageId, allowed);
    }
    if (await allowed) visible.push(f);
  }

  return visible.map((f) => ({
    type: "file" as const,
    id: f.id,
    title: f.title,
    parentFolderId: f.folderPageId,
    iconEmoji: null,
    updatedAt: f.updatedAt,
    href: `/documents/file/${f.id}`,
    sizeBytes: f.currentVersion?.sizeBytes ?? null,
    partnerVisible: f.partnerVisible,
  }));
}

/** Load non-archived agreement templates (SigningDocuments). Only called when
 *  the caller passes `canManageAgreements: true` (= isCore). Agreements with a
 *  `folderPageId` are placed inside that folder; unplaced ones (folderPageId
 *  null) continue to render at the Lab top level as before.
 *
 *  NO-WIDENING GUARANTEE: agreements → Core members only. The caller is
 *  responsible for passing `canManageAgreements` only when the viewer isCore;
 *  this function does not re-derive it, so the gate cannot be bypassed by
 *  omission. */
async function loadAgreements(
  // Wave 2: agreements derive their process label from their own `kind` column
  // rather than the shared linkedProcessMap (their "process" is always the
  // agreement's semantic role, not a specific cycle). The param is accepted but
  // unused — kept for API consistency so callers don't need a special branch.
  _linkedProcessMap?: Map<string, { label: string; href: string }>,
): Promise<DriveItem[]> {
  const rows = await prisma.signingDocument.findMany({
    // Placed-only: agreements live in the Core "agreements" bound folder (see
    // bindings.server.ts). An unplaced row would be one whose folder was cleared
    // and not yet re-filed — don't float it at the Lab root.
    where: { archivedAt: null, folderPageId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, folderPageId: true, updatedAt: true, gateScope: true },
  });
  return rows.map((d) => ({
    type: "agreement" as const,
    id: d.id,
    title: d.name,
    parentFolderId: d.folderPageId,
    iconEmoji: null,
    updatedAt: d.updatedAt,
    href: `/documents/agreement/${d.id}`,
    // Signal ②: agreements always show their semantic role as the process label.
    linkedProcess: { label: agreementProcessLabel(d.gateScope), href: `/documents/agreement/${d.id}` },
  }));
}

/** Load rubrics. Only called when the caller passes `canManageAgreements: true`
 *  (= real isCore) — rubrics live in the Hiring singleton's "rubrics" bound
 *  folder, which is Core-group-scoped (Core-only access). Placed-only (unplaced
 *  ones aren't filed yet); they surface in the Hiring drive space.
 *
 *  NO-WIDENING GUARANTEE: rubrics → Core only, never widened for the hiring team. */
async function loadRubrics(
  linkedProcessMap?: Map<string, { label: string; href: string }>,
): Promise<DriveItem[]> {
  const rows = await prisma.rubric.findMany({
    where: { folderPageId: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, folderPageId: true, updatedAt: true },
  });
  return rows.map((r) => ({
    type: "rubric" as const,
    id: r.id,
    title: r.name,
    parentFolderId: r.folderPageId,
    iconEmoji: null,
    updatedAt: r.updatedAt,
    href: `/hiring/rubrics/${r.id}`,
    linkedProcess: linkedProcessMap?.get(r.id) ?? null,
  }));
}

/** Load forms. Only called when the viewer passes the `canViewForms` gate.
 *  `folderPageId` sets the tree position; it does not change form visibility.
 *
 *  When `scopeFolderIds` is provided the query is narrowed to forms that are
 *  either unplaced (folderPageId null) or placed in one of those folders —
 *  avoiding a full-table scan. Pass all drive folder ids across every scope
 *  to ensure no placed form is missed.
 *
 *  When `linkedProcessMap` is provided (Wave 2, flag ON), each form row gets
 *  its process linkage annotation. */
export async function loadForms(
  scopeFolderIds?: string[],
  linkedProcessMap?: Map<string, { label: string; href: string }>,
): Promise<DriveItem[]> {
  // archivedAt: null ensures soft-deleted forms are excluded from Drive, matching
  // how docs/files are filtered (Page.archivedAt: null, ProjectFile.archivedAt: null).
  const where =
    scopeFolderIds !== undefined
      ? { archivedAt: null, OR: [{ folderPageId: null }, { folderPageId: { in: scopeFolderIds } }] }
      : { archivedAt: null };
  const rows = await prisma.form.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      folderPageId: true,
      updatedAt: true,
    },
  });
  return rows.map((f) => ({
    type: "form" as const,
    id: f.id,
    title: f.name,
    parentFolderId: f.folderPageId,
    iconEmoji: null,
    updatedAt: f.updatedAt,
    href: `/forms/edit/${f.id}`,
    linkedProcess: linkedProcessMap?.get(f.id) ?? null,
  }));
}

/** Load "orphaned" forms: forms placed in a folder that no longer resolves to a
 *  live Drive folder because the folder was archived or deleted. The scoped
 *  `loadForms` query drops them (their `folderPageId` isn't among any visible
 *  scope's folders), so without this they vanish from the Drive while remaining
 *  reachable via search. Surfaced at the General (Lab) root (`parentFolderId:
 *  null`) so no placed form is ever lost.
 *
 *  ACCESS-SAFE: orphan-ness is GLOBAL — the folder is gone for everyone — not
 *  viewer-specific, and form placement is organisation-only; it never gates who
 *  may see or fill a form (see `loadForms`). So surfacing an orphan to any
 *  `canViewForms` viewer widens nothing. */
export async function loadOrphanForms(
  linkedProcessMap?: Map<string, { label: string; href: string }>,
): Promise<DriveItem[]> {
  // Only surface non-archived orphaned forms; archived forms belong in Trash.
  const placed = await prisma.form.findMany({
    where: { folderPageId: { not: null }, archivedAt: null },
    select: { id: true, name: true, folderPageId: true, updatedAt: true },
  });
  if (placed.length === 0) return [];
  // A form is orphaned when its folderPageId has no live (non-archived, still
  // existing) Page — one query resolves which of the referenced folders survive.
  const referencedIds = [...new Set(placed.map((f) => f.folderPageId!))];
  const liveIds = new Set(
    (
      await prisma.page.findMany({
        where: { id: { in: referencedIds }, archivedAt: null },
        select: { id: true },
      })
    ).map((p) => p.id),
  );
  return placed
    .filter((f) => !liveIds.has(f.folderPageId!))
    .map((f) => ({
      type: "form" as const,
      id: f.id,
      title: f.name,
      parentFolderId: null,
      iconEmoji: null,
      updatedAt: f.updatedAt,
      href: `/forms/edit/${f.id}`,
      linkedProcess: linkedProcessMap?.get(f.id) ?? null,
    }));
}

/**
 * Build a map of item-id → `{ label, href }` for every Drive item that is
 * process-bound. Called once per Drive load and the result is
 * passed down into the individual `load*` functions.
 *
 * Resolved linkages:
 *   • forms → hiring cycle (via `ApplicationCycle.applicationFormId`)
 *   • forms → hiring cycle (via `ApplicationCycle.continuedInterestFormId`)
 *   • forms → hiring domain challenge (via `CycleDomainForm`)
 *   • forms → education offering (via `EducationOffering.applicationFormId`)
 *   • agreements → a role label (always-on; hiring confidentiality vs. general)
 *   • email templates → hiring cycle decision/notification binding (first binding wins)
 *   • email templates → education offering decision binding (first binding wins)
 *
 * Rubrics: no process linkage — rubrics are shared across cycles/domains,
 * so a single back-link would be misleading. Left null.
 */
export async function buildLinkedProcessMap(): Promise<Map<string, { label: string; href: string }>> {
  const map = new Map<string, { label: string; href: string }>();

  // ── Forms: hiring cycles (applicationFormId) ──────────────────────────────
  const cycleAppForms = await prisma.applicationCycle.findMany({
    where: { applicationFormId: { not: null } },
    select: { id: true, name: true, applicationFormId: true },
  });
  for (const c of cycleAppForms) {
    if (c.applicationFormId && !map.has(c.applicationFormId)) {
      map.set(c.applicationFormId, {
        label: `Hiring – ${c.name}`,
        href: `/hiring/lead/cycle/${c.id}`,
      });
    }
  }

  // ── Forms: hiring cycles (continuedInterestFormId) ────────────────────────
  const cycleContinuedForms = await prisma.applicationCycle.findMany({
    where: { continuedInterestFormId: { not: null } },
    select: { id: true, name: true, continuedInterestFormId: true },
  });
  for (const c of cycleContinuedForms) {
    if (c.continuedInterestFormId && !map.has(c.continuedInterestFormId)) {
      map.set(c.continuedInterestFormId, {
        label: `Hiring – ${c.name}`,
        href: `/hiring/lead/cycle/${c.id}`,
      });
    }
  }

  // ── Forms: hiring domain challenges (CycleDomainForm) ────────────────────
  // Each challenge form is bound to a specific cycle; use the cycle name.
  const domainForms = await prisma.cycleDomainForm.findMany({
    select: {
      formId: true,
      applicationCycle: { select: { id: true, name: true } },
    },
  });
  for (const df of domainForms) {
    if (!map.has(df.formId)) {
      map.set(df.formId, {
        label: `Hiring – ${df.applicationCycle.name}`,
        href: `/hiring/lead/cycle/${df.applicationCycle.id}`,
      });
    }
  }

  // ── Forms: education offerings (applicationFormId) ────────────────────────
  const offeringAppForms = await prisma.educationOffering.findMany({
    where: { applicationFormId: { not: null } },
    select: { id: true, title: true, applicationFormId: true },
  });
  for (const o of offeringAppForms) {
    if (o.applicationFormId && !map.has(o.applicationFormId)) {
      map.set(o.applicationFormId, {
        label: o.title,
        href: `/education/manage/${o.id}`,
      });
    }
  }

  // ── Agreements: kind label ─────────────────────────────────────────────────
  // Agreements carry their kind on the row itself (loaded in loadAgreements).
  // The label is derived per-row there rather than here — see loadAgreements.

  // ── Email templates: no process files one any more ────────────────────────
  // Hiring's emails stopped being templates in the cycle-timeline rebuild, and
  // education's in the pass that followed — both are now one editable,
  // unversioned email per slot (hiring-emails.server.ts,
  // education-emails.server.ts). Nothing binds an EmailTemplateVersion, so no
  // template in the library is filed against a cycle or a course.

  return map;
}

/**
 * The `linkedProcess` label for an agreement in the Drive listing. There's no
 * single "cycle" to link to (confidentiality is bound per-cycle at signing time,
 * not on the document template), so we show the agreement's role instead —
 * distinguishing the hiring-cycle gate from ordinary lab agreements.
 */
export function agreementProcessLabel(gateScope: string): string {
  return gateScope === "HiringCycle" ? "Hiring – confidentiality" : "Agreement";
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface LoadDriveScopeOptions {
  /**
   * The viewer's user ID (sub). Required — all access checks run as this user.
   */
  userSub: string;
  /**
   * The drive scope to load.
   */
  scope: DriveScope;
  /**
   * Whether this viewer may see forms (`canViewForms` from `~/lib/roles`).
   * Must be computed by the caller and passed here; this function does NOT
   * re-derive it, so the gate can't be accidentally bypassed by omission.
   * Pass `false` (or omit) to exclude forms entirely.
   */
  canViewForms?: boolean;
  /**
   * Whether this viewer may manage (author/view) agreements (= isCore).
   * Must be computed by the caller — this function does NOT re-derive it, so
   * the Core-only gate cannot be bypassed by omission. Only meaningful for
   * Lab-scope loads; agreements never appear in project scopes.
   *
   * NO-WIDENING: agreements → Core only.
   */
  canManageAgreements?: boolean;
  /**
   * Optional request for per-request role-check caching (isCore/isLabMember).
   * Callers from route loaders should pass their `request` object.
   */
  request?: Request;
  /**
   * Pre-fetched form items for this scope, already filtered to forms whose
   * folderPageId belongs to this scope (or unplaced forms for the Lab scope).
   * When provided, `loadDriveScope` skips its own `loadForms()` call —
   * allowing the caller (loadDriveScopes) to fetch all forms in one query and
   * partition per scope, instead of each scope firing its own full-table scan.
   */
  preloadedForms?: DriveItem[];
  /**
   * Pre-fetched Page rows for a Project-scope load, in the exact shape
   * `loadProjectPages` selects (`PROJECT_PAGE_SELECT`). When provided,
   * `loadDriveScope` skips its own `prisma.page.findMany` for the Project
   * branch — callers (e.g. the project route loader) that already fetch
   * these rows for their own page avoid a second identical query. Ignored
   * for non-Project scopes.
   */
  preloadedProjectPages?: ProjectPageRow[];
  /**
   * Pre-fetched ProjectFile rows for a Project-scope load, in the exact
   * shape `loadFiles` selects (`PROJECT_FILE_SELECT`). Same rationale as
   * `preloadedProjectPages`. Ignored for non-Project scopes.
   */
  preloadedProjectFiles?: ProjectFileRow[];
  /**
   * Signal ②: pre-built map of item-id → process linkage, built once per Drive
   * load by `buildLinkedProcessMap()`. When omitted (non-managed scopes) no
   * process pills are rendered.
   */
  linkedProcessMap?: Map<string, { label: string; href: string }>;
}

/**
 * Load all DriveItems the viewer may see in `scope`, normalised to the
 * discriminated-union `DriveItem` shape.
 *
 * ACCESS GUARANTEE (never widens vs pre-unification surfaces):
 *   - Folders/docs: each page goes through `getPageAccess`; only canView pages
 *     are returned. For project scopes, page-level access follows project
 *     membership (same as the documents hub — no per-page extra checks).
 *   - Files: returned only for projects already in the viewer's visible project
 *     set (derived upstream by the caller from the docs-hub project query).
 *   - Forms: returned only when `canViewForms === true`. `folderPageId` is
 *     organisation metadata only; it does NOT widen who can see or fill a form.
 */
export async function loadDriveScope({
  userSub,
  scope,
  canViewForms = false,
  canManageAgreements = false,
  request,
  preloadedForms,
  preloadedProjectPages,
  preloadedProjectFiles,
  linkedProcessMap,
}: LoadDriveScopeOptions): Promise<DriveItem[]> {
  if (scope.kind === "Member") {
    // Private drive: the viewer's own personal notes + files, owner-scoped. No
    // forms or agreements live here.
    const [pages, files] = await Promise.all([
      loadMemberPages(userSub),
      loadMemberFiles(userSub),
    ]);
    return [...pages, ...files];
  }

  if (scope.kind === "Lab") {
    // Lab scope: pages go through getPageAccess; lab-scoped files are visible
    // to all lab members (except scoped-folder files, filtered in loadLabFiles).
    // Project-owned files are NOT included here — they appear only in their
    // respective project scope.
    const [pages, files, agreements, rubrics] = await Promise.all([
      loadLabPages(userSub, request),
      loadLabFiles(userSub, request),
      // Agreements and rubrics are Core-only artifacts living under the Core
      // drive. Both gated on real Core, derived upstream — never widened for the
      // hiring team.
      canManageAgreements ? loadAgreements(linkedProcessMap) : Promise.resolve([] as DriveItem[]),
      canManageAgreements ? loadRubrics(linkedProcessMap) : Promise.resolve([] as DriveItem[]),
    ]);
    // Use preloaded forms when the caller has already fetched them (avoids a
    // repeated full-table scan when loadDriveScopes pre-fetches all at once).
    const forms = preloadedForms ?? (canViewForms ? await loadForms(undefined, linkedProcessMap) : []);
    return [...pages, ...files, ...forms, ...agreements, ...rubrics];
  }

  // EducationOffering scope — pages + uploaded files.
  if (scope.kind === "EducationOffering") {
    const { offeringId } = scope;
    const [pages, files] = await Promise.all([
      loadEducationPages(offeringId, userSub, request),
      loadEducationFiles(offeringId),
    ]);
    const forms = preloadedForms ?? (canViewForms ? await loadForms(undefined, linkedProcessMap) : []);
    return [...pages, ...files, ...forms];
  }

  // Project scope
  const { projectId } = scope;

  // Verify the project exists (and implicitly that the caller has already gated
  // on project access — we don't re-check membership here; the route loader
  // must enforce it before calling loadDriveScope).
  const [pages, files] = await Promise.all([
    loadProjectPages(projectId, userSub, request, preloadedProjectPages),
    loadFiles([projectId], userSub, request, preloadedProjectFiles),
  ]);
  // Use preloaded forms when the caller has already fetched them (avoids a
  // repeated full-table scan when loadDriveScopes pre-fetches all at once).
  const forms = preloadedForms ?? (canViewForms ? await loadForms(undefined, linkedProcessMap) : []);

  return [...pages, ...files, ...forms];
}
