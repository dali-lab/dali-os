// Personal notes — a member's own documents, living in the Member workspace
// (Page.workspaceType = "Member", workspaceId = the owner's User.id).
//
// They're ordinary Pages, so they inherit tags, icons, comments, folders, the
// collab editor and the export pipeline for free. What's specific to them is
// who can read one, which is the whole point of this module: every query that
// returns a personal note goes through visibleNoteFilter or canViewNote, so
// there's one place to get the rule right.
//
// The rule:
//   - the owner sees everything they wrote;
//   - `profileVisible` makes a note public — anyone who can see the profile
//     can read it;
//   - a PageShare row grants read access on its own, ADDITIVELY. A private
//     note shared with a group is readable by that group and still absent
//     from the profile;
//   - a note Core has listed lab-wide is readable by any lab member, since it
//     sits on the shared Documents shelf.
//
// Nothing here grants write access: only the owner edits their own notes.

import { prisma } from "~/lib/db";
import { groupIdsForUser as sharedGroupIdsForUser } from "~/lib/page-sharing.server";
import type { Prisma } from "~/generated/prisma/client";

export type NoteVisibility = "private" | "public";

export class NoteNotFoundError extends Error {
  constructor() {
    super("Note not found");
    this.name = "NoteNotFoundError";
  }
}

export class NoteForbiddenError extends Error {
  constructor(message = "You don't have access to this note") {
    super(message);
    this.name = "NoteForbiddenError";
  }
}

/**
 * Group ids whose membership includes this user. Re-exported from the shared
 * PageShare module — lab documents resolve group membership the same way, and
 * two copies of this would drift.
 */
export const groupIdsForUser = sharedGroupIdsForUser;

/**
 * A `where` fragment matching every personal note `viewerId` may read. Compose
 * it with an owner filter to scope to one profile, or use it alone to find
 * everything shared with someone.
 */
export async function visibleNoteFilter(viewerId: string): Promise<Prisma.PageWhereInput> {
  const groupIds = await groupIdsForUser(viewerId);
  return {
    workspaceType: "Member",
    archivedAt: null,
    OR: [
      // Own notes, whatever their visibility.
      { workspaceId: viewerId },
      // Public — on the owner's profile for everyone.
      { profileVisible: true },
      // Listed on the lab-wide shelf.
      { labListing: "Listed" },
      // Shared directly, or with a group this viewer belongs to.
      { shares: { some: { principalType: "User", principalId: viewerId } } },
      ...(groupIds.length
        ? [{ shares: { some: { principalType: "Group" as const, principalId: { in: groupIds } } } }]
        : []),
    ],
  };
}

export type NoteSummary = {
  id: string;
  title: string;
  iconEmoji: string | null;
  kind: string;
  parentPageId: string | null;
  visibility: NoteVisibility;
  labListing: string;
  updatedAt: string;
  tags: { id: string; label: string; color: string | null }[];
  shareCount: number;
  owner: { id: string; name: string } | null;
};

const NOTE_SELECT = {
  id: true,
  title: true,
  iconEmoji: true,
  kind: true,
  parentPageId: true,
  workspaceId: true,
  profileVisible: true,
  labListing: true,
  updatedAt: true,
  tags: { select: { tag: { select: { id: true, label: true, color: true } } } },
  _count: { select: { shares: true } },
} as const;

type NoteRow = Prisma.PageGetPayload<{ select: typeof NOTE_SELECT }>;

function toSummary(p: NoteRow, ownerName?: string | null): NoteSummary {
  return {
    id: p.id,
    title: p.title,
    iconEmoji: p.iconEmoji,
    kind: p.kind,
    parentPageId: p.parentPageId,
    visibility: p.profileVisible ? "public" : "private",
    labListing: p.labListing,
    updatedAt: p.updatedAt.toISOString(),
    tags: p.tags.map((t) => t.tag),
    shareCount: p._count.shares,
    owner: p.workspaceId && ownerName ? { id: p.workspaceId, name: ownerName } : null,
  };
}

/**
 * Notes to render on a profile. Viewing your own shows everything; viewing
 * someone else's shows what they've made public plus anything they've shared
 * with you specifically.
 */
export async function listProfileNotes(
  ownerId: string,
  viewerId: string,
): Promise<NoteSummary[]> {
  const isSelf = ownerId === viewerId;
  const base = { workspaceType: "Member" as const, workspaceId: ownerId, archivedAt: null };
  const where: Prisma.PageWhereInput = isSelf
    ? base
    : { AND: [base, await visibleNoteFilter(viewerId)] };

  const rows = await prisma.page.findMany({
    where,
    orderBy: [{ parentPageId: "asc" }, { position: "asc" }],
    select: NOTE_SELECT,
  });
  return rows.map((r) => toSummary(r));
}

/**
 * The "Shared with me" inbox: notes someone else wrote that this viewer can
 * read because of an explicit share. Deliberately excludes public and
 * lab-listed notes — those are browsable elsewhere, and an inbox that filled
 * up with everything public would stop being an inbox.
 */
export async function listSharedWithMe(viewerId: string): Promise<NoteSummary[]> {
  const groupIds = await groupIdsForUser(viewerId);
  const rows = await prisma.page.findMany({
    where: {
      workspaceType: "Member",
      archivedAt: null,
      workspaceId: { not: viewerId },
      OR: [
        { shares: { some: { principalType: "User", principalId: viewerId } } },
        ...(groupIds.length
          ? [{ shares: { some: { principalType: "Group" as const, principalId: { in: groupIds } } } }]
          : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: NOTE_SELECT,
  });

  const owners = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.workspaceId!).filter(Boolean))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameById = new Map(
    owners.map((o) => [o.id, `${o.firstName} ${o.lastName}`.trim()]),
  );
  return rows.map((r) => toSummary(r, nameById.get(r.workspaceId ?? "") ?? "Unknown"));
}

/** Personal notes Core has listed on the lab-wide Documents hub. */
export async function listLabListedNotes(): Promise<NoteSummary[]> {
  const rows = await prisma.page.findMany({
    where: { workspaceType: "Member", archivedAt: null, labListing: "Listed" },
    orderBy: { updatedAt: "desc" },
    select: NOTE_SELECT,
  });
  const owners = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.workspaceId!).filter(Boolean))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameById = new Map(
    owners.map((o) => [o.id, `${o.firstName} ${o.lastName}`.trim()]),
  );
  return rows.map((r) => toSummary(r, nameById.get(r.workspaceId ?? "") ?? "Unknown"));
}

/** Notes awaiting a Core decision on lab-wide listing. */
export async function listListingProposals(): Promise<
  (NoteSummary & { proposalNote: string | null })[]
> {
  const rows = await prisma.page.findMany({
    where: { workspaceType: "Member", archivedAt: null, labListing: "Proposed" },
    orderBy: { updatedAt: "asc" },
    select: { ...NOTE_SELECT, labListingNote: true },
  });
  const owners = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.workspaceId!).filter(Boolean))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameById = new Map(
    owners.map((o) => [o.id, `${o.firstName} ${o.lastName}`.trim()]),
  );
  return rows.map((r) => ({
    ...toSummary(r, nameById.get(r.workspaceId ?? "") ?? "Unknown"),
    proposalNote: r.labListingNote,
  }));
}

export type NoteAccess = { canView: boolean; canEdit: boolean; isOwner: boolean };

/** Whether `viewerId` may read (and separately, edit) one personal note. */
export async function noteAccess(pageId: string, viewerId: string): Promise<NoteAccess> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      workspaceType: true,
      workspaceId: true,
      archivedAt: true,
      profileVisible: true,
      labListing: true,
    },
  });
  if (!page || page.workspaceType !== "Member" || !page.workspaceId) {
    throw new NoteNotFoundError();
  }

  const isOwner = page.workspaceId === viewerId;
  // Only the owner writes. Sharing is read-only by design — a shared note is
  // someone's own notebook page, not a collaborative doc.
  if (isOwner) return { canView: true, canEdit: page.archivedAt === null, isOwner: true };

  if (page.archivedAt !== null) return { canView: false, canEdit: false, isOwner: false };
  if (page.profileVisible || page.labListing === "Listed") {
    return { canView: true, canEdit: false, isOwner: false };
  }

  const direct = await prisma.pageShare.findFirst({
    where: { pageId, principalType: "User", principalId: viewerId },
    select: { id: true },
  });
  if (direct) return { canView: true, canEdit: false, isOwner: false };

  const groupIds = await groupIdsForUser(viewerId);
  if (groupIds.length) {
    const viaGroup = await prisma.pageShare.findFirst({
      where: { pageId, principalType: "Group", principalId: { in: groupIds } },
      select: { id: true },
    });
    if (viaGroup) return { canView: true, canEdit: false, isOwner: false };
  }
  return { canView: false, canEdit: false, isOwner: false };
}

export async function requireNoteView(pageId: string, viewerId: string): Promise<NoteAccess> {
  const access = await noteAccess(pageId, viewerId);
  if (!access.canView) throw new NoteForbiddenError();
  return access;
}

export async function requireNoteOwner(pageId: string, viewerId: string): Promise<void> {
  const access = await noteAccess(pageId, viewerId);
  if (!access.isOwner) {
    throw new NoteForbiddenError("Only the note's owner can change it");
  }
}
