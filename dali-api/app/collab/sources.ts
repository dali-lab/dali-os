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
//
// Structured rooms (form:*, rubric:*) store Y.Array/Y.Map rather than a
// BlockNote XmlFragment. Set `structured: true` to skip the prose-only
// getPlainText path in persistence.ts — those rooms use getStructuredData for
// their plainText snapshot mirror instead.

import * as Y from "yjs";
import { prisma } from "~/lib/db";
import { isCore, isDomainLead } from "~/lib/roles";
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
  // For prose rooms: receives blocks (DocBlock[]). For structured rooms:
  // receives the raw serialized shared-type map — callers guard on `structured`.
  syncBack(id: string, blocks: DocBlock[]): Promise<void>;
  // May this user open (== edit) the room?
  authorize(userSub: string, id: string): Promise<boolean>;
  // When true, this room uses Y.Array/Y.Map (not a BlockNote XmlFragment).
  // persistence.ts uses this flag to skip getPlainText (which returns empty
  // for Map rooms) and fall back to a JSON serialisation for the plainText
  // snapshot mirror. seedRegistryDoc is also skipped for structured rooms.
  structured?: true;
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

  // ─── Drive editor draft rooms ──────────────────────────────────────────────

  // signing:{documentId}:draft — prose (BlockNote "agreement" preset). Core-only.
  // Seeding and sync-back handled inline in collabAuth + persistence (not here)
  // because the body lives in SigningDocumentVersion.body, not a simple JSON
  // column. The source entry exists solely to mark the entity as registry-backed
  // so authorizeCollabDoc delegates to its authorize() instead of returning deny.
  // seed() returns null (initial content is seeded from the latest version's body
  // via the collabAuth + loader flow); syncBack() is a no-op here because the
  // "Save Version" action reads readDocAsBlocks() directly from the room.
  signing: {
    async seed(_id) {
      // Caller seeds from the latest SigningDocumentVersion.body via loader;
      // null here starts the room empty for brand-new documents.
      return null;
    },
    async syncBack(_id, _blocks) {
      // Immutable version snapshot is written explicitly by the "Save Version"
      // action — not on every autosave tick. No continuous sync-back.
    },
    async authorize(userSub) {
      return isCore(userSub);
    },
  },

  // form:{formId}:draft — structured Y.Array of question maps. Core-only.
  // The draftQuestions Postgres column is the durable snapshot; the room is
  // the live editing buffer between explicit saves.
  form: {
    structured: true,
    async seed(_id) {
      // Questions seed from Form.draftQuestions is handled by the FormBuilder
      // loader passing initialItems to useSharedArray — not auto-seeded here,
      // because structured rooms cannot use blocksToFragment.
      return null;
    },
    async syncBack(_id, _blocks) {
      // Structured sync-back (Y.Array → Form.draftQuestions) is performed by
      // the FormBuilder's "Save draft" action, which calls readDocAsJson()
      // and writes the result directly — not via the generic block sync path.
    },
    async authorize(userSub) {
      return isCore(userSub);
    },
  },

  // rubric:{rubricId}:draft — structured Y.Array of criteria maps. Core + Domain Lead.
  // RubricVersion.criteria is the durable snapshot; the room is the live buffer.
  rubric: {
    structured: true,
    async seed(_id) {
      // Criteria seed is handled by the RubricDetail loader passing initialItems
      // to useSharedArray from the latest RubricVersion.criteria column.
      return null;
    },
    async syncBack(_id, _blocks) {
      // Structured sync-back (Y.Array → new RubricVersion) is performed by the
      // RubricDetail "Save Version" action via readDocAsJson() — not here.
    },
    async authorize(userSub) {
      // Matches the rubrics.$id loader gate: requireCoreOrDomainLead.
      const [core, lead] = await Promise.all([isCore(userSub), isDomainLead(userSub)]);
      return core || lead;
    },
  },

  // milestone:{setId}:draft — structured Y.Array of milestone entry maps.
  // Core-only. MilestoneSet.draftEntries is the durable working copy; the room
  // is the live buffer. Seed + snapshot are handled by the editor's loader /
  // "Save draft" + "Save version" actions, not here (same as form/rubric).
  milestone: {
    structured: true,
    async seed(_id) {
      // Entries seed from MilestoneSet.draftEntries (or the latest version) is
      // handled by the MilestoneSetEditor loader passing initialItems to
      // useSharedArray — structured rooms cannot use blocksToFragment.
      return null;
    },
    async syncBack(_id, _blocks) {
      // Structured sync-back (Y.Array → draftEntries / new version) is performed
      // by the editor's Save actions via the posted entries JSON — not here.
    },
    async authorize(userSub) {
      return isCore(userSub);
    },
  },
};

// Seed a new room's "blocknote" fragment from its source column. Returns true
// if `entity` is registry-backed (so the caller skips the legacy plain-text
// seed), even when there is nothing to seed yet (the room starts empty).
// Structured rooms (source.structured = true) skip the blocknote fragment write
// — their initial content is seeded client-side via useSharedArray initialItems.
export async function seedRegistryDoc(
  entity: string,
  id: string,
  doc: Y.Doc,
): Promise<boolean> {
  const source = COLLAB_SOURCES[entity];
  if (!source) return false;
  // Structured rooms cannot use the blocknote fragment path — return true to
  // signal "registry-backed" so the caller skips the legacy plain-text seed,
  // but do not write anything (the client hook seeds from initialItems).
  if (source.structured) return true;
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
// plain-text sync). Structured rooms have a no-op syncBack (their snapshot is
// written explicitly by the Save action via readDocAsJson()), so this still
// returns true (skipping the prose plain-text path) without doing any write.
export async function syncRegistryDocBack(
  entity: string,
  id: string,
  doc: Y.Doc,
): Promise<boolean> {
  const source = COLLAB_SOURCES[entity];
  if (!source) return false;
  // Structured rooms: syncBack is a no-op in the source entry — call it to
  // honour the interface, but the blocks argument is unused for them.
  await source.syncBack(id, ydocToBlocks(doc).blocks);
  return true;
}

// Returns true when the named entity has `structured: true` in COLLAB_SOURCES.
// Used by persistence.ts to choose the JSON serialiser over getPlainText.
export function isStructuredRoom(entity: string): boolean {
  return !!COLLAB_SOURCES[entity]?.structured;
}
