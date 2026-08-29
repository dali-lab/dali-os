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
       * Signal ①: the `Page.systemKey` of this folder when it is a system-managed
       * container (e.g. `"drive:core:agreements"`, `"drive:core:templates"`). When
       * set, the Drive UI hides Delete/Rename and shows a "Managed" hover chip.
       * Populated in Wave 2 from the Lab page query; null/undefined elsewhere.
       */
      systemKey?: string | null;
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
    }
  | {
      type: "emailTemplate";
      id: string;
      title: string;
      /** `folderPageId` — null when unplaced. */
      parentFolderId: string | null;
      iconEmoji: null; // email templates have no emoji; callers use a fixed icon
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

/** Load pages (folders + docs) for a Lab-scope drive, filtering each through
 *  getPageAccess so the caller gets exactly what the viewer may view. */
async function loadLabPages(userSub: string, request?: Request): Promise<DriveItem[]> {
  const rows = await prisma.page.findMany({
    where: {
      workspaceType: "Lab",
      workspaceId: null,
      archivedAt: null,
      kind: { in: ["Folder", "FreeForm", "Structured"] },
    },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      kind: true,
      parentPageId: true,
      iconEmoji: true,
      updatedAt: true,
      // Signal ①: systemKey identifies system-managed folders (Agreements, Templates, etc.)
      systemKey: true,
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
            // Signal ①: pass systemKey through so the UI can show the Managed chip
            // and hide destructive actions for system-keyed folders.
            systemKey: row.systemKey ?? null,
          }
        : {
            type: "doc",
            id: row.id,
            title: row.title,
            parentFolderId: row.parentPageId,
            iconEmoji: row.iconEmoji,
            updatedAt: row.updatedAt,
            href: `/documents/${row.id}`,
          },
    );
  }
  return items;
}

/** Load pages for a project-scope drive. Project membership (Core or staffed)
 *  already gates the project query upstream; every page in a visible project is
 *  viewable by project members, so we skip per-page getPageAccess here for
 *  performance. This matches what the docs hub does for project pages. */
async function loadProjectPages(projectId: string): Promise<DriveItem[]> {
  const rows = await prisma.page.findMany({
    where: {
      workspaceType: "Project",
      workspaceId: projectId,
      archivedAt: null,
      kind: { in: ["Folder", "FreeForm", "Structured"] },
    },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      kind: true,
      parentPageId: true,
      iconEmoji: true,
      updatedAt: true,
      partnerVisible: true,
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
          partnerVisible: row.partnerVisible,
        }
      : {
          type: "doc",
          id: row.id,
          title: row.title,
          parentFolderId: row.parentPageId,
          iconEmoji: row.iconEmoji,
          updatedAt: row.updatedAt,
          href: `/documents/${row.id}`,
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

async function loadEducationPages(offeringId: string): Promise<DriveItem[]> {
  const rows = await prisma.page.findMany({
    where: {
      workspaceType: "EducationOffering",
      workspaceId: offeringId,
      archivedAt: null,
      kind: { in: ["Folder", "FreeForm", "Structured"] },
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
          id: row.id,
          title: row.title,
          parentFolderId: row.parentPageId,
          iconEmoji: row.iconEmoji,
          updatedAt: row.updatedAt,
          href: `/documents/${row.id}`,
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
      kind: { in: ["Folder", "FreeForm", "Structured"] },
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
          id: row.id,
          title: row.title,
          parentFolderId: row.parentPageId,
          iconEmoji: row.iconEmoji,
          updatedAt: row.updatedAt,
          href: `/documents/${row.id}`,
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
 *  can see (same query the docs hub uses). */
async function loadFiles(projectIds: string[]): Promise<DriveItem[]> {
  if (projectIds.length === 0) return [];
  const rows = await prisma.projectFile.findMany({
    where: { projectId: { in: projectIds }, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      folderPageId: true,
      updatedAt: true,
      partnerVisible: true,
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
    // Placed-only: agreements live under the Core ▸ Agreements area (filed by
    // ensureCoreDriveRoot). An unplaced row would be a brand-new one awaiting
    // adoption on the next Core drive visit — don't float it at the Lab root.
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
 *  (= real isCore) — rubrics are Core-only artifacts that live under the Core
 *  drive's Rubrics folder. Placed-only (unplaced ones are awaiting adoption).
 *
 *  NO-WIDENING GUARANTEE: rubrics → Core only, never widened for hiring. */
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

/** Load email templates. Only called when the caller passes
 *  `canManageEmailTemplates: true` (= real isCore, NOT the hiring-widened gate)
 *  — email templates are global, Core-only artifacts that live under the Core
 *  drive's Templates area. Templates are filed into that subtree by
 *  `ensureCoreDriveRoot`; the Core-subtree split routes them into the Core scope.
 *
 *  NO-WIDENING GUARANTEE: email templates → Core only. The caller must pass
 *  `canManageEmailTemplates` only when the viewer isCore (never hasHiringAccess). */
async function loadEmailTemplates(
  linkedProcessMap?: Map<string, { label: string; href: string }>,
): Promise<DriveItem[]> {
  const rows = await prisma.emailTemplate.findMany({
    where: { folderPageId: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, folderPageId: true, updatedAt: true },
  });
  return rows.map((t) => ({
    type: "emailTemplate" as const,
    id: t.id,
    title: t.name,
    parentFolderId: t.folderPageId,
    iconEmoji: null,
    updatedAt: t.updatedAt,
    href: `/admin/email-templates/${t.id}`,
    linkedProcess: linkedProcessMap?.get(t.id) ?? null,
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

  // ── Email templates: hiring decision bindings ─────────────────────────────
  const cycleDecisionBindings = await prisma.cycleDecisionEmail.findMany({
    select: {
      emailTemplateVersion: { select: { templateId: true } },
      applicationCycle: { select: { id: true, name: true } },
    },
  });
  for (const b of cycleDecisionBindings) {
    const tId = b.emailTemplateVersion.templateId;
    if (!map.has(tId)) {
      map.set(tId, {
        label: `Hiring – ${b.applicationCycle.name}`,
        href: `/hiring/lead/cycle/${b.applicationCycle.id}`,
      });
    }
  }

  // ── Email templates: hiring notification bindings ─────────────────────────
  const cycleNotifBindings = await prisma.cycleNotificationEmail.findMany({
    select: {
      emailTemplateVersion: { select: { templateId: true } },
      applicationCycle: { select: { id: true, name: true } },
    },
  });
  for (const b of cycleNotifBindings) {
    const tId = b.emailTemplateVersion.templateId;
    if (!map.has(tId)) {
      map.set(tId, {
        label: `Hiring – ${b.applicationCycle.name}`,
        href: `/hiring/lead/cycle/${b.applicationCycle.id}`,
      });
    }
  }

  // ── Email templates: education offering decision bindings ─────────────────
  const eduDecisionBindings = await prisma.educationDecisionEmail.findMany({
    select: {
      emailTemplateVersion: { select: { templateId: true } },
      offering: { select: { id: true, title: true } },
    },
  });
  for (const b of eduDecisionBindings) {
    const tId = b.emailTemplateVersion.templateId;
    if (!map.has(tId)) {
      map.set(tId, {
        label: b.offering.title,
        href: `/education/manage/${b.offering.id}`,
      });
    }
  }

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
   * Whether this viewer may manage email templates (= real isCore, un-widened).
   * Must be computed by the caller. Email templates are global Core-only
   * artifacts that live under the Core drive; unlike agreements this gate is
   * NEVER widened for hiring-team members.
   *
   * NO-WIDENING: email templates → Core only.
   */
  canManageEmailTemplates?: boolean;
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
  canManageEmailTemplates = false,
  request,
  preloadedForms,
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
    const [pages, files, agreements, rubrics, emailTemplates] = await Promise.all([
      loadLabPages(userSub, request),
      loadLabFiles(userSub, request),
      // Agreements, rubrics, and email templates are all Core-only artifacts
      // living under the Core drive (Agreements / Rubrics / Templates). All
      // gated on real Core, derived upstream — never widened for the hiring team.
      canManageAgreements ? loadAgreements(linkedProcessMap) : Promise.resolve([] as DriveItem[]),
      canManageAgreements ? loadRubrics(linkedProcessMap) : Promise.resolve([] as DriveItem[]),
      canManageEmailTemplates ? loadEmailTemplates(linkedProcessMap) : Promise.resolve([] as DriveItem[]),
    ]);
    // Use preloaded forms when the caller has already fetched them (avoids a
    // repeated full-table scan when loadDriveScopes pre-fetches all at once).
    const forms = preloadedForms ?? (canViewForms ? await loadForms(undefined, linkedProcessMap) : []);
    return [...pages, ...files, ...forms, ...agreements, ...rubrics, ...emailTemplates];
  }

  // EducationOffering scope — pages + uploaded files.
  if (scope.kind === "EducationOffering") {
    const { offeringId } = scope;
    const [pages, files] = await Promise.all([
      loadEducationPages(offeringId),
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
    loadProjectPages(projectId),
    loadFiles([projectId]),
  ]);
  // Use preloaded forms when the caller has already fetched them (avoids a
  // repeated full-table scan when loadDriveScopes pre-fetches all at once).
  const forms = preloadedForms ?? (canViewForms ? await loadForms(undefined, linkedProcessMap) : []);

  return [...pages, ...files, ...forms];
}
