import * as Y from "yjs";
import { prisma } from "~/lib/db.server";
import { getCollabServer } from "./server";
import { maybeSnapshot, storeDocument } from "./persistence";
import { readDeck, type DeckRead } from "./read-deck.server";
import { slidesRoomName } from "./roomName";
import { agentAnnouncer, pagePresenceRoom } from "./agent-presence.server";
import { collectDeckTouch, type DeckTouch } from "./deck-touch";

/** Reads the live deck when a collab server in this process holds it, else the stored state. */
export async function readLiveDeck(pageId: string): Promise<{ read: DeckRead; updatedAt: Date | null }> {
  const name = slidesRoomName(pageId);
  const server = getCollabServer();
  if (server) {
    const conn = await server.hocuspocus.openDirectConnection(name);
    try {
      const row = await prisma.collabDocument.findUnique({ where: { name }, select: { updatedAt: true } });
      return { read: readDeck(conn.document as Y.Doc), updatedAt: row?.updatedAt ?? null };
    } finally {
      await conn.disconnect();
    }
  }
  const row = await prisma.collabDocument.findUnique({ where: { name }, select: { state: true, updatedAt: true } });
  const doc = new Y.Doc();
  try {
    if (row) Y.applyUpdate(doc, new Uint8Array(row.state));
    return { read: readDeck(doc), updatedAt: row?.updatedAt ?? null };
  } finally {
    doc.destroy();
  }
}

/** Applies `mutate` to the live deck through the collab server so connected editors see it; falls back to the stored state. */
export async function transactDeck(pageId: string, authorId: string, mutate: (doc: Y.Doc) => void): Promise<void> {
  const name = slidesRoomName(pageId);
  const announce = await agentAnnouncer();
  const run = (live: Y.Doc) => {
    const touch = collectDeckTouch(live, () => mutate(live));
    announceDeckEdit(announce, pageId, touch);
  };
  const server = getCollabServer();
  if (server) {
    const conn = await server.hocuspocus.openDirectConnection(name);
    try {
      await conn.transact(run);
    } finally {
      await conn.disconnect();
    }
    return;
  }
  const live = new Y.Doc();
  try {
    const row = await prisma.collabDocument.findUnique({ where: { name }, select: { state: true } });
    if (row) Y.applyUpdate(live, new Uint8Array(row.state));
    run(live);
    const stored = await storeDocument(name, live);
    if (stored) await maybeSnapshot(name, stored, [authorId]);
  } finally {
    live.destroy();
  }
}

function announceDeckEdit(announce: Awaited<ReturnType<typeof agentAnnouncer>>, pageId: string, touch: DeckTouch): void {
  announce({
    action: "editing",
    presenceRoom: pagePresenceRoom(pageId),
    deckRoom: slidesRoomName(pageId),
    ...(touch.slideId ? { slideId: touch.slideId } : {}),
    touched: touch.elementKeys,
  });
}
