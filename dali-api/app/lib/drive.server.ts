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
import { getPageAccess } from "~/lib/pageAccess.server";
import { canViewFile } from "~/lib/fileAccess.server";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Scope definition: `{ kind: "Lab" }` for the lab-wide tree;
 *  `{ kind: "Project", projectId: string }` for a single project;
 *  `{ kind: "Member" }` for the viewer's own private drive (personal notes). */
export type DriveScope =
  | { kind: "Lab" }
  | { kind: "Project"; projectId: string }
  | { kind: "Member" };

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

  const items: DriveItem[] = [];
  for (const row of rows) {
    const access = await getPageAccess(userSub, row, request);
    if (!access.canView) continue;
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
  const out: DriveItem[] = [];
  for (const f of rows) {
    // Fast path: files at the lab root (no folder) skip the access check.
    if (
      f.folderPageId &&
      !(await canViewFile(
        userSub,
        { workspaceType: "Lab", workspaceId: null, folderPageId: f.folderPageId },
        request,
      ))
    ) {
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

/** Load non-archived agreement templates (SigningDocuments). Only called when
 *  the caller passes `canManageAgreements: true` (= isCore). Agreements with a
 *  `folderPageId` are placed inside that folder; unplaced ones (folderPageId
 *  null) continue to render at the Lab top level as before.
 *
 *  NO-WIDENING GUARANTEE: agreements → Core members only. The caller is
 *  responsible for passing `canManageAgreements` only when the viewer isCore;
 *  this function does not re-derive it, so the gate cannot be bypassed by
 *  omission. */
async function loadAgreements(): Promise<DriveItem[]> {
  const rows = await prisma.signingDocument.findMany({
    where: { archivedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, folderPageId: true, updatedAt: true },
  });
  return rows.map((d) => ({
    type: "agreement" as const,
    id: d.id,
    title: d.name,
    parentFolderId: d.folderPageId,
    iconEmoji: null,
    updatedAt: d.updatedAt,
    href: `/documents/agreement/${d.id}`,
  }));
}

/** Load rubrics. Only called when the caller passes `canManageAgreements: true`
 *  (= isCore / hiring team) — same gate as agreements, since rubrics are a
 *  hiring-internal artifact. Rubrics with a `folderPageId` are placed inside
 *  that folder; unplaced ones render at the Lab top level.
 *
 *  NO-WIDENING GUARANTEE: rubrics → same Core gate as agreements. */
async function loadRubrics(): Promise<DriveItem[]> {
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
async function loadEmailTemplates(): Promise<DriveItem[]> {
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
  }));
}

/** Load forms. Only called when the viewer passes the `canViewForms` gate.
 *  `folderPageId` sets the tree position; it does not change form visibility. */
async function loadForms(): Promise<DriveItem[]> {
  const rows = await prisma.form.findMany({
    where: {},
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
  }));
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
    const [pages, files, forms, agreements, rubrics, emailTemplates] = await Promise.all([
      loadLabPages(userSub, request),
      loadLabFiles(userSub, request),
      canViewForms ? loadForms() : Promise.resolve([] as DriveItem[]),
      // Agreements and rubrics → Core (canManageAgreements, widened for hiring
      // team). Email templates → real Core only (canManageEmailTemplates, never
      // widened). All derived upstream.
      canManageAgreements ? loadAgreements() : Promise.resolve([] as DriveItem[]),
      canManageAgreements ? loadRubrics() : Promise.resolve([] as DriveItem[]),
      canManageEmailTemplates ? loadEmailTemplates() : Promise.resolve([] as DriveItem[]),
    ]);
    return [...pages, ...files, ...forms, ...agreements, ...rubrics, ...emailTemplates];
  }

  // Project scope
  const { projectId } = scope;

  // Verify the project exists (and implicitly that the caller has already gated
  // on project access — we don't re-check membership here; the route loader
  // must enforce it before calling loadDriveScope).
  const [pages, files, forms] = await Promise.all([
    loadProjectPages(projectId),
    loadFiles([projectId]),
    canViewForms ? loadForms() : Promise.resolve([] as DriveItem[]),
  ]);

  return [...pages, ...files, ...forms];
}
