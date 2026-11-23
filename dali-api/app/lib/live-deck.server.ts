import * as Y from "yjs";
import { prisma } from "~/lib/db.server";
import { slidesRoomName } from "~/collab/roomName";
import { initDeck } from "~/components/slides/deck/model";

export function emptyDeckState(): Uint8Array {
  const doc = new Y.Doc();
  try {
    initDeck(doc);
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/** Leaves a Slides page as an empty live deck: a SlideDeck row and an initialised room. Safe to repeat and to race. */
export async function ensureLiveDeck(pageId: string, authorId?: string): Promise<void> {
  const name = slidesRoomName(pageId);
  const [row, room] = await Promise.all([
    prisma.slideDeck.findUnique({ where: { pageId }, select: { pageId: true } }),
    prisma.collabDocument.findUnique({ where: { name }, select: { name: true } }),
  ]);
  if (!row) {
    await prisma.slideDeck.createMany({
      data: [{ pageId, ...(authorId ? { lastEditedById: authorId } : {}) }],
      skipDuplicates: true,
    });
  }
  if (!room) {
    await prisma.collabDocument.createMany({
      data: [{ name, state: emptyDeckState() as Uint8Array<ArrayBuffer> }],
      skipDuplicates: true,
    });
  }
}
