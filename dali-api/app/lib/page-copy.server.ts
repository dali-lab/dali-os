// Server-side helper for duplicating a FreeForm Page and its collaborative
// document body. Used by both "Duplicate page" and "Start from template".
//
// Y.Doc content copy mechanics:
//   The collab body lives in `CollabDocument.state` (a Uint8Array Y-update blob
//   keyed by the room name `doc:{pageId}:body`). A byte copy under a new room
//   name is correct and cheap — Y.encodeStateAsUpdate produces a single update
//   that encodes the full document, so copying it verbatim to the new room gives
//   the new page the exact same initial state. Hocuspocus will load it on first
//   connection. No structural CRDT invariants are violated by the copy because
//   each Y.Doc is independent (no cross-doc references in the state blob).
//
// What is NOT copied: DocComment rows (Notion behaviour — copies start clean).

import { prisma } from "~/lib/db";
import { getPageAccess } from "~/lib/pageAccess.server";
import type { WorkspaceType, PageKind } from "~/generated/prisma/client";

export interface DuplicatePageInput {
  sourcePageId: string;
  createdById: string;
  // Override title (used when seeding from a template; omit to get "<title> (copy)").
  titleOverride?: string;
  // The new page inherits the source's workspace unless overridden.
  workspaceTypeOverride?: WorkspaceType;
  workspaceIdOverride?: string | null;
  parentPageIdOverride?: string | null;
}

export interface DuplicatePageResult {
  id: string;
}

/**
 * Duplicate a FreeForm Page: copy the Page row (title → "<title> (copy)" or
 * titleOverride) and byte-copy the CollabDocument state under the new page's
 * room name. Non-FreeForm pages are rejected — they have no collab body.
 *
 * Permission check: the caller must already have canEdit access to the source
 * page's workspace (the caller is creating a new page there). The access check
 * is done server-side via getPageAccess.
 */
export async function duplicatePage(
  input: DuplicatePageInput,
): Promise<DuplicatePageResult> {
  const source = await prisma.page.findUnique({
    where: { id: input.sourcePageId },
    select: {
      id: true,
      title: true,
      workspaceType: true,
      workspaceId: true,
      parentPageId: true,
      kind: true,
      iconEmoji: true,
      coverImageUrl: true,
      archivedAt: true,
    },
  });
  if (!source || source.archivedAt !== null) {
    throw new Error("Page not found");
  }

  const targetWorkspaceType = input.workspaceTypeOverride ?? source.workspaceType;
  const targetWorkspaceId =
    input.workspaceIdOverride !== undefined
      ? input.workspaceIdOverride
      : source.workspaceId;
  const targetParentPageId =
    input.parentPageIdOverride !== undefined
      ? input.parentPageIdOverride
      : source.parentPageId;

  // Verify the user can create pages in the target workspace.
  const access = await getPageAccess(input.createdById, {
    id: source.id,
    workspaceType: targetWorkspaceType,
    workspaceId: targetWorkspaceId,
    archivedAt: null,
  });
  if (!access.canEdit) {
    throw new Error("Permission denied");
  }

  // Determine position: append after current siblings.
  const last = await prisma.page.findFirst({
    where: {
      workspaceType: targetWorkspaceType,
      workspaceId: targetWorkspaceId,
      parentPageId: targetParentPageId,
    },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const newTitle =
    input.titleOverride !== undefined
      ? input.titleOverride
      : `${source.title} (copy)`;

  // Create the new Page row.
  const newPage = await prisma.page.create({
    data: {
      workspaceType: targetWorkspaceType,
      workspaceId: targetWorkspaceId,
      parentPageId: targetParentPageId,
      title: newTitle,
      kind: source.kind as PageKind,
      iconEmoji: source.iconEmoji,
      coverImageUrl: source.coverImageUrl,
      position,
      createdById: input.createdById,
      // Never carry isTemplate forward — a duplicate is a real page.
      isTemplate: false,
    },
    select: { id: true },
  });

  // Copy the Y.Doc state blob from the source room to the new room.
  // Room name convention: `doc:{pageId}:body` (see app/collab/roomName.ts).
  const srcName = `doc:${source.id}:body`;
  const dstName = `doc:${newPage.id}:body`;

  const srcDoc = await prisma.collabDocument.findUnique({
    where: { name: srcName },
    select: { state: true },
  });
  if (srcDoc) {
    await prisma.collabDocument.create({
      data: { name: dstName, state: srcDoc.state },
    });
  }
  // If no CollabDocument exists for the source yet (it's never been opened),
  // the new page just starts empty — same as any brand-new page.

  return { id: newPage.id };
}
