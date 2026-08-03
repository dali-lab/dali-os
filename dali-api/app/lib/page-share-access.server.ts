// Who may manage a page's sharing, plus the general-access setter and the
// "shared with you" notification. This is the AUTHZ layer that sits on top of
// the pure PageShare primitives in page-sharing.server.ts — that module states
// it authorises nothing; this one is its gate.
//
// "Managing sharing" means editing the named access list AND the document-level
// General access setting (Google's "General access" row). The right to do so is
// derived from workspace role, reusing the existing per-workspace gates so the
// rule never diverges from how each workspace already decides who's in charge:
//   - Lab     → any lab member (creator/Core once restricted) — labDocAccess
//   - Member  → the note's owner — noteAccess
//   - Project → Core or a project member — same as requireProjectEditAccess
//   - Education → Core or an assigned instructor
// Plus one cross-workspace addition from the FullAccess tier: anyone granted
// FullAccess on the page may re-share it (that's what FullAccess means).

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { isCore, isProjectMember } from "~/lib/roles";
import { sharePermissionFor } from "~/lib/page-sharing.server";
import type {
  WorkspaceType,
  LinkAccess,
  SharePermission,
} from "~/generated/prisma/client";

export class PageShareNotFoundError extends Error {
  constructor() {
    super("Document not found");
    this.name = "PageShareNotFoundError";
  }
}

export class PageShareForbiddenError extends Error {
  constructor(message = "You can't manage this document's sharing") {
    super(message);
    this.name = "PageShareForbiddenError";
  }
}

export class GeneralAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneralAccessError";
  }
}

/** The page fields the manage check needs — pass the row if you already hold it. */
export type ManagePageShape = {
  id: string;
  workspaceType: WorkspaceType;
  workspaceId: string | null;
  createdById: string | null;
  labRestricted: boolean;
};

/**
 * Non-throwing: may `userId` manage `page`'s sharing? Accepts a loaded row so
 * the document loader (which already holds the page) doesn't re-query.
 */
export async function canManageSharing(
  page: ManagePageShape,
  userId: string,
): Promise<boolean> {
  switch (page.workspaceType) {
    case "Lab": {
      const { labDocAccess } = await import("~/lib/lab-documents.server");
      const access = await labDocAccess(
        { id: page.id, createdById: page.createdById, labRestricted: page.labRestricted },
        userId,
      );
      if (access.canManageAccess) return true;
      break;
    }
    case "Member": {
      const { noteAccess } = await import("~/members/lib/personal-notes.server");
      const access = await noteAccess(page.id, userId);
      if (access.isOwner) return true;
      break;
    }
    case "Project": {
      if (page.workspaceId && ((await isCore(userId)) || (await isProjectMember(userId, page.workspaceId)))) {
        return true;
      }
      break;
    }
    case "EducationOffering": {
      if (page.workspaceId) {
        if (await isCore(userId)) return true;
        const instructor = await prisma.instructorAssignment.findFirst({
          where: { userId, offeringId: page.workspaceId },
          select: { id: true },
        });
        if (instructor) return true;
      }
      break;
    }
  }
  // A FullAccess grantee can re-share, whatever the workspace.
  return (await sharePermissionFor(page.id, userId)) === "FullAccess";
}

export type PageShareManagerContext = {
  page: { id: string; title: string; workspaceType: WorkspaceType; workspaceId: string | null };
  // The document's owner, pinned atop the people list (like Google's owner row).
  // Member notes: the note owner. Everything else: the creator.
  owner: { id: string; name: string; isYou: boolean } | null;
  // Current General access setting, for the dialog's "General access" row.
  linkAccess: LinkAccess;
  linkPermission: SharePermission;
  // Current workspace-specific visibility toggles, so the dialog renders the
  // right switches with their live values without a second fetch.
  labRestricted: boolean;
  profileVisible: boolean;
  labListing: string;
  partnerVisible: boolean;
  publicVisible: boolean;
  studentEditable: boolean;
};

const MANAGE_SELECT = {
  id: true,
  title: true,
  workspaceType: true,
  workspaceId: true,
  createdById: true,
  archivedAt: true,
  labRestricted: true,
  profileVisible: true,
  labListing: true,
  partnerVisible: true,
  publicVisible: true,
  studentEditable: true,
  linkAccess: true,
  linkPermission: true,
} as const;

/**
 * Load a page and assert `userId` may manage its sharing. Returns the context
 * the Share dialog needs. Throws PageShareNotFoundError for a missing/archived
 * page and PageShareForbiddenError when the actor may not manage it.
 */
export async function requirePageShareManager(
  pageId: string,
  userId: string,
): Promise<PageShareManagerContext> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: MANAGE_SELECT,
  });
  if (!page || page.archivedAt) throw new PageShareNotFoundError();

  const allowed = await canManageSharing(
    {
      id: page.id,
      workspaceType: page.workspaceType,
      workspaceId: page.workspaceId,
      createdById: page.createdById,
      labRestricted: page.labRestricted,
    },
    userId,
  );
  if (!allowed) throw new PageShareForbiddenError();

  // Owner = the note owner for Member pages, otherwise the creator.
  const ownerId = page.workspaceType === "Member" ? page.workspaceId : page.createdById;
  let owner: PageShareManagerContext["owner"] = null;
  if (ownerId) {
    const u = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (u) {
      owner = {
        id: u.id,
        name: `${u.firstName} ${u.lastName}`.trim() || "Unknown",
        isYou: u.id === userId,
      };
    }
  }

  return {
    page: {
      id: page.id,
      title: page.title,
      workspaceType: page.workspaceType,
      workspaceId: page.workspaceId,
    },
    owner,
    linkAccess: page.linkAccess,
    linkPermission: page.linkPermission,
    labRestricted: page.labRestricted,
    profileVisible: page.profileVisible,
    labListing: page.labListing,
    partnerVisible: page.partnerVisible,
    publicVisible: page.publicVisible,
    studentEditable: page.studentEditable,
  };
}

/**
 * Set a page's General access. Caller MUST gate first (requirePageShareManager).
 * Enforces the two invariants the model relies on:
 *   - a Public link is view-only (no identity to attribute comment/edit to);
 *   - general access never grants FullAccess (re-share is a named grant only).
 * Restricted normalises linkPermission back to View so a stale higher value
 * can't leak if it's later widened without re-picking a role.
 */
export async function setGeneralAccess(
  pageId: string,
  actorId: string,
  input: { linkAccess: LinkAccess; linkPermission: SharePermission },
): Promise<{ linkAccess: LinkAccess; linkPermission: SharePermission }> {
  const linkAccess = input.linkAccess;
  let linkPermission = input.linkPermission;
  if (linkPermission === "FullAccess") {
    throw new GeneralAccessError("Links can't grant full access");
  }
  if (linkAccess === "Public" || linkAccess === "Restricted") {
    linkPermission = "View";
  }
  await prisma.page.update({
    where: { id: pageId },
    data: { linkAccess, linkPermission },
  });
  await logAuditEvent({
    action: "page.general-access",
    userId: actorId,
    targetId: pageId,
    metadata: { linkAccess, linkPermission },
  });
  return { linkAccess, linkPermission };
}

/**
 * "Shared with you" in-app/desktop notification. Fire-and-forget from the share
 * route; only for named User shares that actually changed (new or level-raised),
 * never groups and never general-access changes.
 */
export async function notifyDocumentShared(args: {
  pageId: string;
  pageTitle: string;
  recipientUserId: string;
  actorId: string;
}): Promise<void> {
  const { notify } = await import("~/lib/notify.server");
  await notify({
    eventType: "document.shared_with_you",
    createdByUserId: args.actorId,
    message: {
      title: `Shared with you: ${args.pageTitle}`,
      link: `/documents/${args.pageId}`,
    },
    recipients: [{ userId: args.recipientUserId }],
  });
}
