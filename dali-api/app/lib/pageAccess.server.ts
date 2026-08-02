// Single source of truth for page-level access decisions.
//
// Rules are extracted from documents.$pageId.tsx loader (view + edit gates)
// and collabAuth.ts doc: branch (edit gate), consolidated here so they stay
// in sync across the collab socket, comments API, and future surfaces.
//
// Approved decisions:
//   canComment = canView   (anyone who can read the doc can comment)
//   canResolve = canEdit || Core
//
// Meeting-note pages: the loader admits archived meeting-note pages so
// attendees can still reach the check-in/attendance surface. We do NOT
// open collab or comment for archived pages — those gates stay strict.

import { prisma } from "~/lib/db";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";

export interface PageAccessResult {
  canView: boolean;
  canEdit: boolean;
  canComment: boolean;
  canResolve: boolean;
}

export interface PageShape {
  id: string;
  workspaceType: string;
  workspaceId: string | null;
  archivedAt?: Date | null;
  createdById?: string | null;
  partnerVisible?: boolean | null;
  labRestricted?: boolean | null;
  [key: string]: unknown;
}

/**
 * Compute access for a user on a page whose fields are already loaded.
 * Pass the page object directly when you already have the row.
 */
export async function getPageAccess(
  userSub: string,
  page: PageShape,
): Promise<PageAccessResult>;

/**
 * Convenience overload: fetch the page by id, then compute access.
 * Throws if the page is not found.
 */
export async function getPageAccess(
  userSub: string,
  pageId: string,
): Promise<PageAccessResult>;

export async function getPageAccess(
  userSub: string,
  pageOrId: PageShape | string,
): Promise<PageAccessResult> {
  let page: PageShape;

  if (typeof pageOrId === "string") {
    const row = await prisma.page.findUnique({
      where: { id: pageOrId },
      select: {
        id: true,
        workspaceType: true,
        workspaceId: true,
        archivedAt: true,
        partnerVisible: true,
        createdById: true,
        labRestricted: true,
      },
    });
    if (!row) {
      return { canView: false, canEdit: false, canComment: false, canResolve: false };
    }
    page = row;
  } else {
    page = pageOrId;
  }

  // Archived pages: no access at all (collab/comments gate).
  // The route loader has a carve-out for meeting-note pages at the UI level,
  // but the collab socket and comments rail must not open on archived pages.
  if (page.archivedAt != null) {
    return { canView: false, canEdit: false, canComment: false, canResolve: false };
  }

  // ── Member-workspace (personal notes) ────────────────────────────────────
  // Privacy is the whole point. Core gets NO bypass here.
  if (page.workspaceType === "Member") {
    if (!page.workspaceId) {
      return { canView: false, canEdit: false, canComment: false, canResolve: false };
    }
    try {
      const { noteAccess } = await import("~/members/lib/personal-notes.server");
      const access = await noteAccess(page.id, userSub);
      if (!access.canView) {
        return { canView: false, canEdit: false, canComment: false, canResolve: false };
      }
      // canEdit = owner only (sharing is always read-only for Member pages).
      const canEdit = access.isOwner && access.canEdit;
      return {
        canView: true,
        canEdit,
        canComment: true,
        canResolve: canEdit,
      };
    } catch {
      return { canView: false, canEdit: false, canComment: false, canResolve: false };
    }
  }

  // ── Core shortcut (Admin ⊆ Core) — applies to Lab/Project/Education ─────
  const core = await isCore(userSub);

  // ── Lab-workspace pages ──────────────────────────────────────────────────
  // Any lab member can view AND edit Lab pages, unless the document has been
  // restricted to its creator plus an explicit share list.
  if (page.workspaceType === "Lab") {
    const { labDocAccess } = await import("~/lib/lab-documents.server");
    const access = await labDocAccess(
      {
        id: page.id,
        createdById: page.createdById ?? null,
        labRestricted: (page.labRestricted as boolean | undefined) ?? false,
      },
      userSub,
    );
    return {
      canView: access.canView,
      canEdit: access.canEdit,
      canComment: access.canView,
      canResolve: access.canEdit,
    };
  }

  // ── Project-workspace pages ──────────────────────────────────────────────
  if (page.workspaceType === "Project" && page.workspaceId) {
    if (core) {
      return { canView: true, canEdit: true, canComment: true, canResolve: true };
    }
    const projectMember = await isProjectMember(userSub, page.workspaceId);
    if (projectMember) {
      return { canView: true, canEdit: true, canComment: true, canResolve: true };
    }
    // Partner users may view (and comment) on partner-visible pages.
    if (page.partnerVisible) {
      const partnerView = await partnerHasProjectAccess(userSub, page.workspaceId);
      if (partnerView) {
        return { canView: true, canEdit: false, canComment: true, canResolve: false };
      }
    }
    // Lab members can view (and comment) any project page — they are not
    // members of the project but still lab staff who have read access to all
    // project work. canComment = canView per the approved rule.
    const labMember = await isLabMember(userSub);
    if (labMember) {
      return { canView: true, canEdit: false, canComment: true, canResolve: false };
    }
    return { canView: false, canEdit: false, canComment: false, canResolve: false };
  }

  // ── EducationOffering-workspace pages ────────────────────────────────────
  // Instructors can edit; enrolled students get read/comment but no collab
  // room (the offering hub renders course materials server-side read-only —
  // this path is for non-student access checks only; the collab room stays
  // instructor-only per the existing collabAuth gate).
  if (page.workspaceType === "EducationOffering" && page.workspaceId) {
    if (core) {
      return { canView: true, canEdit: true, canComment: true, canResolve: true };
    }
    const instructor = await prisma.instructorAssignment.findFirst({
      where: { userId: userSub, offeringId: page.workspaceId },
      select: { id: true },
    });
    if (instructor) {
      return { canView: true, canEdit: true, canComment: true, canResolve: true };
    }
    // Non-instructor lab members may view education pages but not edit.
    const member = await isLabMember(userSub);
    if (member) {
      return { canView: true, canEdit: false, canComment: true, canResolve: false };
    }
    return { canView: false, canEdit: false, canComment: false, canResolve: false };
  }

  // Unknown workspace type — deny.
  return { canView: false, canEdit: false, canComment: false, canResolve: false };
}
