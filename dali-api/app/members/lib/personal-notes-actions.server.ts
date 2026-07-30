// Writes for personal notes: create, rename/icon, folders, visibility,
// sharing, lab-listing proposals and Core's decision on them.
//
// Every write except the Core review path goes through requireNoteOwner —
// sharing is read-only, so nobody but the owner ever mutates one of these.

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { pageDocName } from "~/collab/roomName";
import {
  NoteForbiddenError,
  NoteNotFoundError,
  requireNoteOwner,
} from "./personal-notes.server";
import type { SharePrincipalType } from "~/generated/prisma/client";

export async function createNote(
  ownerId: string,
  input: { title?: string; parentPageId?: string | null; isFolder?: boolean },
): Promise<{ id: string }> {
  const parentPageId = input.parentPageId ?? null;
  if (parentPageId) {
    // Two-level cap, same as every other workspace: a folder holds notes, and
    // nothing nests deeper.
    const parent = await prisma.page.findUnique({
      where: { id: parentPageId },
      select: { workspaceType: true, workspaceId: true, parentPageId: true, kind: true },
    });
    if (!parent || parent.workspaceType !== "Member" || parent.workspaceId !== ownerId) {
      throw new NoteNotFoundError();
    }
    if (parent.parentPageId !== null || parent.kind !== "Folder") {
      throw new NoteForbiddenError("Notes can only be nested one level, inside a folder");
    }
  }

  const last = await prisma.page.findFirst({
    where: { workspaceType: "Member", workspaceId: ownerId, parentPageId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  return prisma.page.create({
    data: {
      workspaceType: "Member",
      workspaceId: ownerId,
      parentPageId,
      title: input.title?.trim() || (input.isFolder ? "Untitled folder" : "Untitled"),
      kind: input.isFolder ? "Folder" : "FreeForm",
      position: last ? last.position + 1 : 0,
      createdById: ownerId,
    },
    select: { id: true },
  });
}

export async function updateNote(
  pageId: string,
  ownerId: string,
  input: { title?: string; iconEmoji?: string | null; parentPageId?: string | null },
): Promise<void> {
  await requireNoteOwner(pageId, ownerId);
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new NoteForbiddenError("A note needs a title");
    data.title = title;
  }
  if (input.iconEmoji !== undefined) data.iconEmoji = input.iconEmoji || null;
  if (input.parentPageId !== undefined) data.parentPageId = input.parentPageId || null;
  if (Object.keys(data).length === 0) return;
  data.lastEditedById = ownerId;
  await prisma.page.update({ where: { id: pageId }, data });
}

/**
 * Public/private. Making a note private doesn't clear its share list — the two
 * are independent, and silently dropping shares would lose who the owner had
 * chosen. It only stops the note appearing on the profile.
 */
export async function setNoteVisibility(
  pageId: string,
  ownerId: string,
  isPublic: boolean,
): Promise<void> {
  await requireNoteOwner(pageId, ownerId);
  await prisma.page.update({
    where: { id: pageId },
    data: { profileVisible: isPublic },
  });
  await logAuditEvent({
    action: "note.visibility",
    userId: ownerId,
    targetId: pageId,
    metadata: { profileVisible: isPublic },
  });
}

export async function addNoteShare(
  pageId: string,
  ownerId: string,
  principalType: SharePrincipalType,
  principalId: string,
): Promise<{ ok: true; alreadyShared: boolean }> {
  await requireNoteOwner(pageId, ownerId);

  if (principalType === "User") {
    if (principalId === ownerId) {
      throw new NoteForbiddenError("You already have access to your own note");
    }
    const user = await prisma.user.findUnique({
      where: { id: principalId },
      select: { id: true },
    });
    if (!user) throw new NoteNotFoundError();
  } else {
    const group = await prisma.groupDefinition.findUnique({
      where: { id: principalId },
      select: { id: true, archivedAt: true },
    });
    if (!group) throw new NoteNotFoundError();
    if (group.archivedAt) {
      throw new NoteForbiddenError("That group is archived");
    }
  }

  const existing = await prisma.pageShare.findUnique({
    where: {
      pageId_principalType_principalId: { pageId, principalType, principalId },
    },
    select: { id: true },
  });
  if (existing) return { ok: true, alreadyShared: true };

  await prisma.pageShare.create({
    data: { pageId, principalType, principalId, createdById: ownerId },
  });
  return { ok: true, alreadyShared: false };
}

export async function removeNoteShare(
  pageId: string,
  ownerId: string,
  shareId: string,
): Promise<void> {
  await requireNoteOwner(pageId, ownerId);
  await prisma.pageShare.deleteMany({ where: { id: shareId, pageId } });
}

/** Who a note is currently shared with, resolved to display names. */
export async function listNoteShares(
  pageId: string,
  ownerId: string,
): Promise<{ id: string; principalType: string; principalId: string; label: string }[]> {
  await requireNoteOwner(pageId, ownerId);
  const shares = await prisma.pageShare.findMany({
    where: { pageId },
    orderBy: { createdAt: "asc" },
    select: { id: true, principalType: true, principalId: true },
  });
  if (shares.length === 0) return [];

  const userIds = shares.filter((s) => s.principalType === "User").map((s) => s.principalId);
  const groupIds = shares.filter((s) => s.principalType === "Group").map((s) => s.principalId);
  const [users, groups] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
    groupIds.length
      ? prisma.groupDefinition.findMany({
          where: { id: { in: groupIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  return shares.map((s) => ({
    ...s,
    label:
      s.principalType === "User"
        ? (userName.get(s.principalId) ?? "Unknown member")
        : (groupName.get(s.principalId) ?? "Unknown group"),
  }));
}

/**
 * Ask Core to put this note on the lab-wide Documents hub. Only public notes
 * are eligible: the hub is readable by every lab member, so proposing a
 * private note would mean asking Core to widen its audience by proxy.
 */
export async function proposeLabListing(
  pageId: string,
  ownerId: string,
  note: string | null,
): Promise<void> {
  await requireNoteOwner(pageId, ownerId);
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { profileVisible: true, labListing: true, kind: true },
  });
  if (!page) throw new NoteNotFoundError();
  if (page.kind === "Folder") {
    throw new NoteForbiddenError("Folders can't be listed — propose a note instead");
  }
  if (!page.profileVisible) {
    throw new NoteForbiddenError("Make the note public before proposing it for the lab");
  }
  if (page.labListing === "Listed") return;

  await prisma.page.update({
    where: { id: pageId },
    data: {
      labListing: "Proposed",
      labListingNote: note?.trim() || null,
      labListingReviewedById: null,
      labListingReviewedAt: null,
    },
  });
  await logAuditEvent({
    action: "note.lab-listing.propose",
    userId: ownerId,
    targetId: pageId,
    metadata: {},
  });
}

export async function withdrawLabListing(pageId: string, ownerId: string): Promise<void> {
  await requireNoteOwner(pageId, ownerId);
  await prisma.page.update({
    where: { id: pageId },
    data: { labListing: "None", labListingNote: null },
  });
}

/** Core's decision on a proposal. */
export async function reviewLabListing(
  pageId: string,
  reviewerId: string,
  decision: "Listed" | "Declined",
): Promise<void> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { workspaceType: true, labListing: true, profileVisible: true },
  });
  if (!page || page.workspaceType !== "Member") throw new NoteNotFoundError();
  if (page.labListing !== "Proposed") {
    throw new NoteForbiddenError("That note isn't awaiting review");
  }
  if (decision === "Listed" && !page.profileVisible) {
    // The owner could have flipped it private after proposing.
    throw new NoteForbiddenError("The note is no longer public, so it can't be listed");
  }
  await prisma.page.update({
    where: { id: pageId },
    data: {
      labListing: decision,
      labListingReviewedById: reviewerId,
      labListingReviewedAt: new Date(),
    },
  });
  await logAuditEvent({
    action: "note.lab-listing.review",
    userId: reviewerId,
    targetId: pageId,
    metadata: { decision },
  });
}

/** Archive (soft-delete) a note, and stop it being visible anywhere. */
export async function archiveNote(pageId: string, ownerId: string): Promise<void> {
  await requireNoteOwner(pageId, ownerId);
  const children = await prisma.page.count({ where: { parentPageId: pageId } });
  if (children > 0) {
    throw new NoteForbiddenError(
      `This folder still holds ${children} note(s) — move or archive them first`,
    );
  }
  await prisma.page.update({
    where: { id: pageId },
    data: {
      archivedAt: new Date(),
      profileVisible: false,
      labListing: "None",
    },
  });
}

/** Permanently delete a note and its body. */
export async function deleteNote(pageId: string, ownerId: string): Promise<void> {
  await requireNoteOwner(pageId, ownerId);
  const children = await prisma.page.count({ where: { parentPageId: pageId } });
  if (children > 0) {
    throw new NoteForbiddenError(
      `This folder still holds ${children} note(s) — move or delete them first`,
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.collabDocument.deleteMany({ where: { name: pageDocName(pageId) } });
    await tx.page.delete({ where: { id: pageId } });
  });
  await logAuditEvent({
    action: "note.delete",
    userId: ownerId,
    targetId: pageId,
    metadata: {},
  });
}
