// Registry of rich-text surfaces backed by a collaborative Yjs room. One entry
// per surface makes "turn a local-JSON field into a collaborative document" a
// single, uniform change: declare how a new room SEEDS from its source column,
// how live edits SYNC BACK to that column (so any non-collab read path keeps
// rendering current content), and WHO may open it.
//
// A room open is an EDIT grant (there is no read-only collab connection), so
// `authorize` is the write gate; non-editors read the always-synced source
// column (or a server-side snapshot decode) instead.
//
// Post-BlockNote-migration, source columns hold BLOCK JSON (an array of
// blocks). Legacy ProseMirror JSON (`{type:"doc"}`) still seeds correctly —
// ensureBlocks maps it — and the first sync-back rewrites the column as
// blocks.

import * as Y from "yjs";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  BLOCKNOTE_FRAGMENT,
  blocksToFragment,
  type DocBlock,
} from "./blocknote-server";
import { ensureBlocks } from "./legacy/pm-to-blocknote";
import { ydocToBlocks } from "./read";

export interface CollabSource {
  // Initial content for a brand-new room (no CollabDocument row yet). Returns
  // the raw source column value — block JSON or legacy PM JSON; the seeder
  // normalizes via ensureBlocks. Return null to start empty.
  seed(id: string): Promise<unknown>;
  // Persist the live doc back to the source column after each store.
  syncBack(id: string, blocks: DocBlock[]): Promise<void>;
  // May this user open (== edit) the room?
  authorize(userSub: string, id: string): Promise<boolean>;
}

export const COLLAB_SOURCES: Record<string, CollabSource> = {
  // Mentorship weekly note body. The author (mentor) + Core edit; other
  // same-domain mentors read the synced contentJson. Seeded/synced through
  // contentJson so note creation (which copies the default template) is
  // unchanged.
  mentorNote: {
    async seed(id) {
      const note = await prisma.mentorNote.findUnique({
        where: { id },
        select: { contentJson: true },
      });
      return note?.contentJson ?? null;
    },
    async syncBack(id, blocks) {
      await prisma.mentorNote.update({
        where: { id },
        data: { contentJson: blocks as unknown as object },
      });
    },
    async authorize(userSub, id) {
      const note = await prisma.mentorNote.findUnique({
        where: { id },
        select: { mentorId: true },
      });
      if (!note) return false;
      return note.mentorId === userSub || (await isCore(userSub));
    },
  },

  // Mentorship note template body. Core-only.
  mentorNoteTemplate: {
    async seed(id) {
      const tpl = await prisma.mentorNoteTemplate.findUnique({
        where: { id },
        select: { contentJson: true },
      });
      return tpl?.contentJson ?? null;
    },
    async syncBack(id, blocks) {
      await prisma.mentorNoteTemplate.update({
        where: { id },
        data: { contentJson: blocks as unknown as object },
      });
    },
    async authorize(userSub) {
      return isCore(userSub);
    },
  },
};

// Seed a new room's "blocknote" fragment from its source column. Returns true
// if `entity` is registry-backed (so the caller skips the legacy plain-text
// seed), even when there is nothing to seed yet (the room starts empty).
export async function seedRegistryDoc(
  entity: string,
  id: string,
  doc: Y.Doc,
): Promise<boolean> {
  const source = COLLAB_SOURCES[entity];
  if (!source) return false;
  const blocks = ensureBlocks(await source.seed(id));
  if (blocks.length > 0) {
    doc.transact(() => {
      blocksToFragment(blocks, doc.getXmlFragment(BLOCKNOTE_FRAGMENT));
    });
  }
  return true;
}

// Sync a registry surface's live doc back to its source column as block JSON.
// Returns true if `entity` is registry-backed (so the caller skips the legacy
// plain-text sync).
export async function syncRegistryDocBack(
  entity: string,
  id: string,
  doc: Y.Doc,
): Promise<boolean> {
  const source = COLLAB_SOURCES[entity];
  if (!source) return false;
  await source.syncBack(id, ydocToBlocks(doc).blocks);
  return true;
}
