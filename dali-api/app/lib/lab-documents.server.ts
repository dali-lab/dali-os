// Access rules for lab-wide documents (Page.workspaceType = "Lab").
//
// A lab document's audience is set through General access, exactly like every
// other workspace: "Everyone in the lab" (linkAccess=LabMembers) grants every
// lab member the doc's linkPermission tier; "Only people you add"
// (linkAccess=Restricted) limits it to the creator, Core, and the named
// PageShare list. getPageAccess resolves all of that — this module only answers
// two lab-specific questions: who may change a lab doc's sharing, and which lab
// documents show up in the Documents hub for a given viewer.
//
// Core is never locked out: the hub is the lab's own shelf and Core curates it.

import { isCore, isLabMember } from "~/lib/roles";
import { groupIdsForUser } from "~/lib/page-sharing.server";
import type { Prisma, LinkAccess } from "~/generated/prisma/client";

export type LabDocAccess = {
  /** May the user change the doc's sharing / General access: creator or Core. */
  canManageAccess: boolean;
};

/**
 * Manage-access for one lab document. View/edit are resolved by getPageAccess
 * (General access + named shares); this only answers who controls sharing —
 * the creator or Core. A non-member can never manage a lab doc.
 */
export async function labDocAccess(
  page: { id: string; createdById?: string | null },
  userId: string,
): Promise<LabDocAccess> {
  const [member, core] = await Promise.all([isLabMember(userId), isCore(userId)]);
  return { canManageAccess: core || (member && page.createdById === userId) };
}

/**
 * A `where` fragment matching every lab document `viewerId` may read. Core
 * callers should skip it — they see the whole shelf. A doc is visible when it's
 * open to the lab ("Everyone in the lab" / "Anyone with the link"), authored by
 * the viewer, or shared with them directly or via a group.
 */
export async function visibleLabDocFilter(viewerId: string): Promise<Prisma.PageWhereInput> {
  const groupIds = await groupIdsForUser(viewerId);
  return {
    OR: [
      { linkAccess: { in: ["LabMembers", "Public"] as LinkAccess[] } },
      { createdById: viewerId },
      { shares: { some: { principalType: "User", principalId: viewerId } } },
      ...(groupIds.length
        ? [{ shares: { some: { principalType: "Group" as const, principalId: { in: groupIds } } } }]
        : []),
    ],
  };
}
