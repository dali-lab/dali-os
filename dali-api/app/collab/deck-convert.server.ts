import * as Y from "yjs";
import { prisma } from "~/lib/db.server";
import { parseSlides } from "~/components/slides/slide-schema";
import { slidesMap } from "~/components/slides/deck/model";
import type { Slide } from "~/components/slides/types";
import { slidesRoomName } from "./roomName";
import { seedDeckDoc } from "./deck-write.server";

export interface ConversionTx {
  getState(name: string): Promise<Uint8Array | null>;
  putState(name: string, state: Uint8Array): Promise<void>;
  flipStorage(): Promise<boolean>;
  readLegacy(): Promise<Slide[]>;
}

export interface ConversionStore {
  withLock<T>(name: string, fn: (tx: ConversionTx) => Promise<T>): Promise<T>;
}

/** The Y.Doc gets a random clientID: a fixed one dedupes against itself and silently drops later content. */
export async function loadOrConvertDeck(
  store: ConversionStore,
  name: string,
): Promise<{ state: Uint8Array; converted: boolean }> {
  return store.withLock(name, async (tx) => {
    const existing = await tx.getState(name);
    if (existing) {
      await tx.flipStorage();
      return { state: existing, converted: false };
    }
    const doc = new Y.Doc();
    try {
      seedDeckDoc(doc, await tx.readLegacy());
      const state = Y.encodeStateAsUpdate(doc);
      await tx.putState(name, state);
      await tx.flipStorage();
      return { state, converted: true };
    } finally {
      doc.destroy();
    }
  });
}

export function deckSlideCount(state: Uint8Array): number {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return slidesMap(doc).size;
  } finally {
    doc.destroy();
  }
}

const prismaStore = (pageId: string): ConversionStore => ({
  withLock: (name, fn) =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${name}))`;
        return fn({
          async getState(n) {
            const row = await tx.collabDocument.findUnique({ where: { name: n }, select: { state: true } });
            return row ? new Uint8Array(row.state) : null;
          },
          async putState(n, state) {
            await tx.collabDocument.create({ data: { name: n, state: state as Uint8Array<ArrayBuffer> } });
          },
          async flipStorage() {
            const { count } = await tx.slideDeck.updateMany({ where: { pageId, storage: "json" }, data: { storage: "yjs" } });
            return count === 1;
          },
          async readLegacy() {
            const row = await tx.slideDeck.upsert({
              where: { pageId },
              create: { pageId },
              update: {},
              select: { slides: true },
            });
            return parseSlides(row.slides) ?? [];
          },
        });
      },
      { timeout: 20_000 },
    ),
});

/** Moves a JSON deck into its room. Safe to call from many machines at once and to repeat. */
export async function convertDeckToYjs(pageId: string): Promise<{ converted: boolean }> {
  const { converted } = await loadOrConvertDeck(prismaStore(pageId), slidesRoomName(pageId));
  return { converted };
}
