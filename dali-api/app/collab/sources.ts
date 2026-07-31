// Registry of rich-text surfaces backed by a collaborative Yjs room. One entry
// per surface makes "turn a local-JSON field into a collaborative document" a
// single, uniform change: declare how a new room SEEDS from its source column,
// how live edits SYNC BACK to that column (so any non-collab read path keeps
// rendering current content), and WHO may open it.
//
// A room open is an EDIT grant (there is no read-only collab connection), so
// `authorize` is the write gate; non-editors read the always-synced source
// column (or a server-side snapshot decode) instead.

import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { pmJsonToYDoc, replaceFragment } from "./pm-to-y";
import type { PMNode } from "./export-html";

export interface CollabSource {
  // Initial content for a brand-new room (no CollabDocument row yet). Return
  // null to start empty.
  seed(id: string): Promise<PMNode | null>;
  // Persist the live doc back to the source column after each store.
  syncBack(id: string, json: PMNode): Promise<void>;
  // May this user open (== edit) the room?
  authorize(userSub: string, id: string): Promise<boolean>;
}

// A ProseMirror doc is `{ type: "doc", content: [...] }`. The MentorNote /
// template columns default to `{}` (empty object) — not a valid doc — so guard
// before seeding, or prosemirrorJSONToYDoc throws on schema validation.
function asPmDoc(value: unknown): PMNode | null {
  return value && typeof value === "object" && (value as { type?: string }).type === "doc"
    ? (value as PMNode)
    : null;
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
      return note ? asPmDoc(note.contentJson) : null;
    },
    async syncBack(id, json) {
      await prisma.mentorNote.update({
        where: { id },
        data: { contentJson: json as object },
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
      return tpl ? asPmDoc(tpl.contentJson) : null;
    },
    async syncBack(id, json) {
      await prisma.mentorNoteTemplate.update({
        where: { id },
        data: { contentJson: json as object },
      });
    },
    async authorize(userSub) {
      return isCore(userSub);
    },
  },
};

// Seed a new room's fragment from its source's ProseMirror JSON. Returns true if
// `entity` is registry-backed (so the caller skips the legacy plain-text seed),
// even when there is nothing to seed yet (the room starts empty).
export async function seedRegistryDoc(
  entity: string,
  id: string,
  doc: Y.Doc,
): Promise<boolean> {
  const source = COLLAB_SOURCES[entity];
  if (!source) return false;
  const json = await source.seed(id);
  if (json) {
    const tmp = pmJsonToYDoc(json);
    replaceFragment(doc.getXmlFragment("default"), tmp.getXmlFragment("default"));
    tmp.destroy();
  }
  return true;
}

// Sync a registry surface's live doc back to its source column. Returns true if
// `entity` is registry-backed (so the caller skips the legacy plain-text sync).
export async function syncRegistryDocBack(
  entity: string,
  id: string,
  doc: Y.Doc,
): Promise<boolean> {
  const source = COLLAB_SOURCES[entity];
  if (!source) return false;
  const json = yDocToProsemirrorJSON(doc, "default") as PMNode;
  await source.syncBack(id, json);
  return true;
}
