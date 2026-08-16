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
//
// Wave 2 (drive scope): scopeKind on Folder pages cascades access downward.
// With no explicitly-scoped folders in the DB, getPageAccess returns exactly
// the same result as before — the ancestry walk falls through to the existing
// workspaceType-derived logic.

import { prisma } from "~/lib/db";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { groupIdsForUser, permissionAtLeast, PERMISSION_RANK } from "~/lib/page-sharing.server";
import { resolveGroupMembers } from "~/lib/groups";
import type { SharePermission, LinkAccess, ScopeKind } from "~/generated/prisma/client";

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
  profileVisible?: boolean | null;
  labListing?: string | null;
  // Loose like workspaceType/labListing above — the enum values live in the DB;
  // shareAndLinkGrant casts. Keeping these `string` lets callers pass rows
  // without importing the Prisma enum types.
  linkAccess?: string | null;
  linkPermission?: string | null;
  [key: string]: unknown;
}

const DENIED: PageAccessResult = {
  canView: false,
  canEdit: false,
  canComment: false,
  canResolve: false,
};
const FULL: PageAccessResult = { canView: true, canEdit: true, canComment: true, canResolve: true };
// Role-based read access (lab member on a project doc, public-visible note viewer,
// etc.): may read and comment but not edit. Matches the pre-tier rule that anyone
// who can see a doc can comment on it.
const VIEW_COMMENT: PageAccessResult = {
  canView: true,
  canEdit: false,
  canComment: true,
  canResolve: false,
};

/** The access a named share / general-access tier confers, on its own. */
function permToAccess(level: SharePermission): PageAccessResult {
  switch (level) {
    case "View":
      return { canView: true, canEdit: false, canComment: false, canResolve: false };
    case "Comment":
      return { canView: true, canEdit: false, canComment: true, canResolve: false };
    case "Edit":
    case "FullAccess":
      return { canView: true, canEdit: true, canComment: true, canResolve: true };
  }
}

/** Field-wise OR — a share/link grant only ever adds access, never removes it. */
function merge(a: PageAccessResult, b: PageAccessResult): PageAccessResult {
  return {
    canView: a.canView || b.canView,
    canEdit: a.canEdit || b.canEdit,
    canComment: a.canComment || b.canComment,
    canResolve: a.canResolve || b.canResolve,
  };
}

function higher(a: SharePermission | null, b: SharePermission): SharePermission {
  if (!a) return b;
  return permissionAtLeast(a, b) ? a : b;
}

/**
 * Derive the highest share permission for `userSub` from a pre-fetched slice
 * of PageShare rows (already filtered or unfiltered for this page). Called by
 * both the single-page and bulk paths so the logic can't diverge.
 */
function sharePermissionFromRows(
  rows: Array<{ principalType: string; principalId: string; permission: SharePermission }>,
  userSub: string,
  groupIds: string[],
): SharePermission | null {
  const relevant = rows.filter(
    (r) =>
      (r.principalType === "User" && r.principalId === userSub) ||
      (r.principalType === "Group" && groupIds.includes(r.principalId)),
  );
  if (relevant.length === 0) return null;
  return relevant.reduce<SharePermission>(
    (best, r) => (PERMISSION_RANK[r.permission] > PERMISSION_RANK[best] ? r.permission : best),
    "View",
  );
}

/**
 * Access implied by the additive layers — a named PageShare (per-account or via
 * group) and the document-level General access setting — independent of the
 * page's workspace role rules. Returned as its own access result so the caller
 * ORs it onto the role base. `LabMembers` general access grants to lab members
 * only (not partner/applicant/non-member Dartmouth accounts); `Public` grants a
 * read-only view to any caller that reaches getPageAccess.
 *
 * `preloadedShares` — when provided, skips the per-page DB fetch (bulk path).
 * `preloadedGroupIds` — when provided, skips the groupIdsForUser fetch.
 */
async function shareAndLinkGrant(
  page: PageShape,
  userSub: string,
  request?: Request,
  preloadedShares?: Array<{ principalType: string; principalId: string; permission: SharePermission }>,
  preloadedGroupIds?: string[],
): Promise<PageAccessResult> {
  const groupIds = preloadedGroupIds ?? (await groupIdsForUser(userSub, request));
  const sharesForPage = preloadedShares ?? await (async () => {
    // Single-page path: fetch the shares for this one page (original behaviour).
    const rows = await prisma.pageShare.findMany({
      where: {
        pageId: page.id,
        OR: [
          { principalType: "User", principalId: userSub },
          ...(groupIds.length
            ? [{ principalType: "Group" as const, principalId: { in: groupIds } }]
            : []),
        ],
      },
      select: { principalType: true, principalId: true, permission: true },
    });
    return rows;
  })();

  let level = sharePermissionFromRows(sharesForPage, userSub, groupIds);
  const linkAccess = (page.linkAccess as LinkAccess | null | undefined) ?? "Restricted";
  if (linkAccess === "LabMembers") {
    if (await isLabMember(userSub, request)) {
      level = higher(level, (page.linkPermission as SharePermission | null | undefined) ?? "View");
    }
  } else if (linkAccess === "Public") {
    level = higher(level, "View");
  }
  return level ? permToAccess(level) : DENIED;
}

// ── Drive scope ancestry walk (Wave 2) ─────────────────────────────────────
//
// Rows fetched while walking the parent chain. We batch-fetch up to
// MAX_ANCESTOR_WALK levels to avoid N+1 loops.
const MAX_ANCESTOR_WALK = 8; // generous ceiling above MAX_PAGE_DEPTH

type AncestorRow = {
  id: string;
  parentPageId: string | null;
  scopeKind: ScopeKind | null;
  scopeGroupId: string | null;
  scopePermission: SharePermission | null;
  createdById: string | null;
};

/**
 * Walk the parentPageId chain from `startParentId` toward the root and return
 * the nearest ancestor folder that has a non-null scopeKind, or null if none
 * exists. Stops at MAX_ANCESTOR_WALK to keep query cost bounded.
 *
 * This is called only when the item or its parent chain might carry a scope.
 * With no scoped folders in the DB every call terminates at the root and
 * returns null — the early-exit that makes this a no-op today.
 */
// Whether a page nested under `parentPageId` would fall inside a scoped folder
// (i.e. some ancestor — including the parent itself — carries a scopeKind).
// Used by the create/move endpoints to decide whether a new/moved page should
// default to Restricted general access (scoped drives govern access; the
// "everyone in the lab" link grant is off inside them, so the scope isn't
// silently widened). Returns false for a top-level (null-parent) placement.
export async function isUnderGoverningScope(parentPageId: string | null): Promise<boolean> {
  if (!parentPageId) return false;
  return (await findGoverningScope(parentPageId)) !== null;
}

async function findGoverningScope(
  startParentId: string | null,
): Promise<AncestorRow | null> {
  let id: string | null = startParentId;
  let steps = 0;
  while (id !== null && steps < MAX_ANCESTOR_WALK) {
    const row = await prisma.page.findUnique({
      where: { id },
      select: {
        id: true,
        parentPageId: true,
        scopeKind: true,
        scopeGroupId: true,
        scopePermission: true,
        createdById: true,
      },
    });
    if (!row) break;
    if (row.scopeKind !== null) return row; // governing folder found
    id = row.parentPageId;
    steps++;
  }
  return null;
}

/**
 * Whether `userSub` is a member of the scope defined by `governing`.
 * Returns the base access level the scope grants, or DENIED if not a member.
 * `ownerId` is used only for the Private scope.
 */
async function scopeBase(
  governing: AncestorRow,
  userSub: string,
  ownerId: string | null,
  request?: Request,
): Promise<PageAccessResult> {
  const basePerm: SharePermission =
    governing.scopePermission ??
    (governing.scopeKind === "Lab" ? "View" : "Edit");

  switch (governing.scopeKind as ScopeKind) {
    case "Private": {
      // Only the owner gets the base grant; others reach the doc via named share only.
      return governing.createdById === userSub || ownerId === userSub
        ? permToAccess(basePerm)
        : DENIED;
    }
    case "Lab": {
      return (await isLabMember(userSub, request)) ? permToAccess(basePerm) : DENIED;
    }
    case "Group": {
      if (!governing.scopeGroupId) return DENIED;
      const members = await resolveGroupMembers(governing.scopeGroupId);
      return members.includes(userSub) ? permToAccess(basePerm) : DENIED;
    }
    default:
      return DENIED;
  }
}

/**
 * Compute access for a user on a page whose fields are already loaded.
 * Pass the page object directly when you already have the row.
 */
export async function getPageAccess(
  userSub: string,
  page: PageShape,
  request?: Request,
): Promise<PageAccessResult>;

/**
 * Convenience overload: fetch the page by id, then compute access.
 * Throws if the page is not found.
 */
export async function getPageAccess(
  userSub: string,
  pageId: string,
  request?: Request,
): Promise<PageAccessResult>;

// `request` (optional) scopes the per-user role checks (isCore/isLabMember/
// isProjectMember) to one navigation via cachedForRequest. Callers that fan
// this out over many pages in a single request — the sidebar Favorites/Recents
// read — pass it so those identical per-user queries run once, not once per page.
export async function getPageAccess(
  userSub: string,
  pageOrId: PageShape | string,
  request?: Request,
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
        profileVisible: true,
        labListing: true,
        linkAccess: true,
        linkPermission: true,
        parentPageId: true,
        scopeKind: true,
        scopeGroupId: true,
        scopePermission: true,
      },
    });
    if (!row) return DENIED;
    page = row;
  } else {
    page = pageOrId;
  }

  return computePageAccessCore(userSub, page, request);
}

/**
 * Core access-computation logic, shared between `getPageAccess` (single page)
 * and `getPageAccessBulk` (pre-fetched batch). Accepts optional pre-fetched
 * share rows and groupIds so the bulk path can avoid per-page DB round-trips
 * while guaranteed to produce identical results.
 *
 * `preloadedShares` — when provided, skips the per-page pageShare.findMany
 *   (bulk path pre-fetches all shares in one query).
 * `preloadedGroupIds` — when provided, skips the groupIdsForUser fetch.
 */
async function computePageAccessCore(
  userSub: string,
  page: PageShape,
  request?: Request,
  preloadedShares?: Array<{ principalType: string; principalId: string; permission: SharePermission }>,
  preloadedGroupIds?: string[],
): Promise<PageAccessResult> {
  // Archived pages: no access at all (collab/comments gate).
  // The route loader has a carve-out for meeting-note pages at the UI level,
  // but the collab socket and comments rail must not open on archived pages.
  if (page.archivedAt != null) return DENIED;

  // Additive layers (named shares + General access), computed once and ORed onto
  // each workspace's role-based base below. They only ever grant more access —
  // never a downgrade — and carry the exact View/Comment/Edit/FullAccess tier,
  // so a "View" share does not confer comment the way role-based viewing does.
  const extra = await shareAndLinkGrant(page, userSub, request, preloadedShares, preloadedGroupIds);

  // ── Member-workspace (personal notes) ────────────────────────────────────
  // Privacy is the whole point. Core gets NO bypass here — only the owner (full)
  // and public/lab-listed viewers (read + comment) get role-based access; anyone
  // else reaches the doc solely through `extra` (a share or General access).
  // This branch runs BEFORE the core shortcut below — that order is load-bearing.
  if (page.workspaceType === "Member") {
    let base = DENIED;
    if (page.workspaceId === userSub) {
      base = FULL; // owner; page is non-archived (checked above)
    } else if (page.profileVisible || page.labListing === "Listed") {
      base = VIEW_COMMENT;
    }
    return merge(base, extra);
  }

  // ── Drive scope (Wave 2) ─────────────────────────────────────────────────
  //
  // Check whether this page is governed by an explicitly-scoped folder. The
  // governing folder is the nearest ancestor (including the page itself, if it
  // is a Folder) whose scopeKind is non-null.
  //
  // If the page carries a scopeKind directly (it IS the governing folder), use
  // it. Otherwise walk up the parentPageId chain. If no governing folder is
  // found — the common case today, where no scope columns are set — skip this
  // block entirely and fall through to the existing workspaceType logic below.
  //
  // Nesting only narrows: if multiple scoped folders exist on the path, the
  // most restrictive base wins. We take only the *nearest* ancestor's scope
  // (the spec says the nearest governing folder shadows further ancestors), so
  // one walk is sufficient.
  //
  // The ancestry walk (findGoverningScope) is kept per-page — batching it safely
  // would require materialising the full parent chain for every page upfront,
  // which is not straightforward and the common case (no scope set) already
  // terminates at the root and returns null immediately.
  const pageScopeKind = page.scopeKind as ScopeKind | null | undefined;
  const pageParentPageId = page.parentPageId as string | null | undefined;

  let governing: AncestorRow | null = null;
  if (pageScopeKind) {
    // The page itself is (or acts as) the governing folder.
    governing = {
      id: page.id,
      parentPageId: pageParentPageId ?? null,
      scopeKind: pageScopeKind,
      scopeGroupId: (page.scopeGroupId as string | null | undefined) ?? null,
      scopePermission: (page.scopePermission as SharePermission | null | undefined) ?? null,
      createdById: (page.createdById as string | null | undefined) ?? null,
    };
  } else if (pageParentPageId) {
    // Walk up; terminates fast (returns null) when no ancestor has a scope set.
    governing = await findGoverningScope(pageParentPageId);
  }

  if (governing !== null) {
    // A scope is in effect. Creator always keeps a base grant (softener); the
    // scope's member set is the authoritative base otherwise.
    const creatorBase =
      page.createdById === userSub ? permToAccess(governing.scopePermission ?? "Edit") : DENIED;
    const memberBase = await scopeBase(governing, userSub, page.workspaceId, request);
    const base = merge(creatorBase, memberBase);
    return merge(base, extra);
  }

  // ── No explicit scope set — existing workspaceType-derived logic (UNCHANGED) ──

  // ── Core shortcut (Admin ⊆ Core) — applies to Lab/Project/Education ─────
  const core = await isCore(userSub, request);

  // ── Lab-workspace pages ──────────────────────────────────────────────────
  // The creator and Core always get full access (and manage rights). Every
  // other lab member reaches the doc through `extra`: General access
  // "Everyone in the lab" (linkAccess=LabMembers) carries the doc's
  // View/Comment/Edit tier via linkPermission, and named people/group shares
  // carry theirs. "Only people you add" is just linkAccess=Restricted — the
  // creator/Core base plus whatever's on the share list.
  if (page.workspaceType === "Lab") {
    const base = core || page.createdById === userSub ? FULL : DENIED;
    return merge(base, extra);
  }

  // ── Project-workspace pages ──────────────────────────────────────────────
  if (page.workspaceType === "Project" && page.workspaceId) {
    let base = DENIED;
    if (core || (await isProjectMember(userSub, page.workspaceId, request))) {
      base = FULL;
    } else if (page.partnerVisible && (await partnerHasProjectAccess(userSub, page.workspaceId))) {
      // Partner users may view (and comment) on partner-visible pages.
      base = VIEW_COMMENT;
    } else if (await isLabMember(userSub, request)) {
      // Lab members can view (and comment) any project page.
      base = VIEW_COMMENT;
    }
    return merge(base, extra);
  }

  // ── EducationOffering-workspace pages ────────────────────────────────────
  // Instructors (and Core) can edit; non-instructor lab members get read/comment.
  if (page.workspaceType === "EducationOffering" && page.workspaceId) {
    let base = DENIED;
    if (core) {
      base = FULL;
    } else {
      const instructor = await prisma.instructorAssignment.findFirst({
        where: { userId: userSub, offeringId: page.workspaceId },
        select: { id: true },
      });
      if (instructor) base = FULL;
      else if (await isLabMember(userSub, request)) base = VIEW_COMMENT;
    }
    return merge(base, extra);
  }

  // Unknown workspace type — role grants nothing, but a share / General access
  // on the page (if any) still applies.
  return merge(DENIED, extra);
}

/**
 * Batch variant of `getPageAccess` — resolves access for a list of pages in
 * one pageShare.findMany instead of N per-page fetches.
 *
 * The result for each page is IDENTICAL to `getPageAccess(userId, page, request)`
 * — same logic, same boolean semantics. This is access control; the batch
 * optimisation must never change the outcome.
 *
 * The governing-scope ancestry walk (findGoverningScope) remains per-page
 * because materialising the full parent chain for all pages upfront is not
 * straightforward and the common case (no scope set) already returns null
 * immediately — no extra round-trips in practice.
 */
export async function getPageAccessBulk(
  userId: string,
  pages: PageShape[],
  request?: Request,
): Promise<Map<string, PageAccessResult>> {
  if (pages.length === 0) return new Map();

  const pageIds = pages.map((p) => p.id);

  // One query for all shares across the page list — avoids the N×pageShare.findMany
  // that getPageAccess would fire when called once per page.
  const allShareRows = await prisma.pageShare.findMany({
    where: { pageId: { in: pageIds } },
    select: { pageId: true, principalType: true, principalId: true, permission: true },
  });

  // Group by pageId for O(1) per-page lookup below.
  const sharesByPage = new Map<string, Array<{ principalType: string; principalId: string; permission: SharePermission }>>();
  for (const row of allShareRows) {
    let list = sharesByPage.get(row.pageId);
    if (!list) {
      list = [];
      sharesByPage.set(row.pageId, list);
    }
    list.push({ principalType: row.principalType, principalId: row.principalId, permission: row.permission });
  }

  // Resolve groupIds once for this user — memoised by cachedForRequest when
  // a request is available, so this is effectively free if the caller already
  // triggered it for another page.
  const groupIds = await groupIdsForUser(userId, request);

  const result = new Map<string, PageAccessResult>();
  await Promise.all(
    pages.map(async (page) => {
      const sharesForPage = sharesByPage.get(page.id) ?? [];
      const access = await computePageAccessCore(userId, page, request, sharesForPage, groupIds);
      result.set(page.id, access);
    }),
  );
  return result;
}
