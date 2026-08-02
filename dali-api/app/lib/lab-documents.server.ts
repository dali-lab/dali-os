// Access rules and writes for lab-wide documents (Page.workspaceType = "Lab").
//
// A lab document is readable and editable by every lab member by default —
// that is what the Documents hub is for. `labRestricted` narrows one to its
// creator plus whoever is on its PageShare list, using the same additive grant
// personal notes use.
//
// Core is never locked out. The hub is the lab's own shelf and Core curates
// it, so "restricted" means "off the shelf", not "sealed". The manage-access
// dialog states this rather than implying a privacy the model doesn't give.
//
// Who may change a document's access: any lab member, same as every other
// action on the lab shelf. A lab document is communal — any member can already
// create, edit, archive, pin and move one — so gating access alone on
// authorship would be the odd rule out, and would hide the control on exactly
// the documents most people work with (the ones somebody else started).
//
// A restricted document is the one exception: once it's narrowed, only the
// people who can still see it can change who else can, or a member could
// un-restrict a document they were never meant to read.

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { isCore, isLabMember } from "~/lib/roles";
import { groupIdsForUser, isSharedWith } from "~/lib/page-sharing.server";
import type { Prisma } from "~/generated/prisma/client";

export class LabDocNotFoundError extends Error {
  constructor() {
    super("Document not found");
    this.name = "LabDocNotFoundError";
  }
}

export class LabDocForbiddenError extends Error {
  constructor(message = "You can't change this document's access") {
    super(message);
    this.name = "LabDocForbiddenError";
  }
}

export type LabDocAccess = {
  canView: boolean;
  canEdit: boolean;
  /** Any lab member who can still see the document. */
  canManageAccess: boolean;
};

/**
 * Access for one lab document. Callers that already hold the row should pass
 * it to avoid a second read; `pageAccess.server.ts` does.
 */
export async function labDocAccess(
  page: { id: string; createdById?: string | null; labRestricted?: boolean | null },
  userId: string,
): Promise<LabDocAccess> {
  const [member, core] = await Promise.all([isLabMember(userId), isCore(userId)]);
  if (!member && !core) {
    return { canView: false, canEdit: false, canManageAccess: false };
  }

  // Unrestricted: the pre-existing rule — any lab member reads and writes,
  // and any lab member may narrow it.
  if (!page.labRestricted) {
    return { canView: true, canEdit: true, canManageAccess: true };
  }

  if (page.createdById === userId || core) {
    return { canView: true, canEdit: true, canManageAccess: true };
  }

  // Shares are read-only, matching personal notes: being given a document is
  // not the same as being given the pen — or the guest list.
  const shared = await isSharedWith(page.id, userId);
  return { canView: shared, canEdit: false, canManageAccess: false };
}

/**
 * A `where` fragment matching every lab document `viewerId` may read. Core
 * callers should skip it — they see the whole shelf.
 */
export async function visibleLabDocFilter(viewerId: string): Promise<Prisma.PageWhereInput> {
  const groupIds = await groupIdsForUser(viewerId);
  return {
    OR: [
      { labRestricted: false },
      { createdById: viewerId },
      { shares: { some: { principalType: "User", principalId: viewerId } } },
      ...(groupIds.length
        ? [{ shares: { some: { principalType: "Group" as const, principalId: { in: groupIds } } } }]
        : []),
    ],
  };
}

/** Loads a lab document and asserts the actor may change its access list. */
export async function requireLabDocAccessManager(
  pageId: string,
  userId: string,
): Promise<{ id: string; title: string; labRestricted: boolean }> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      title: true,
      workspaceType: true,
      workspaceId: true,
      archivedAt: true,
      createdById: true,
      labRestricted: true,
    },
  });
  if (!page || page.workspaceType !== "Lab" || page.workspaceId !== null || page.archivedAt) {
    throw new LabDocNotFoundError();
  }
  const access = await labDocAccess(page, userId);
  if (!access.canManageAccess) throw new LabDocForbiddenError();
  return { id: page.id, title: page.title, labRestricted: page.labRestricted };
}

/**
 * Public/private for a lab document. Widening back to the whole lab keeps the
 * share list — the same choice notes make, so re-restricting doesn't ask the
 * owner to rebuild an audience they already picked.
 */
export async function setLabDocRestricted(
  pageId: string,
  userId: string,
  restricted: boolean,
): Promise<void> {
  await requireLabDocAccessManager(pageId, userId);
  await prisma.page.update({
    where: { id: pageId },
    data: { labRestricted: restricted },
  });
  await logAuditEvent({
    action: "lab-document.access",
    userId,
    targetId: pageId,
    metadata: { labRestricted: restricted },
  });
}
