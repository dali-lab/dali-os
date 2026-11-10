import * as Y from "yjs";
import { comparePos, deckMap, isDeleted, slidesMap } from "./model";
import { deckFields, snapshotSlide, type DeckSnapshot, type RenderSlide } from "./snapshot";

export interface DeckStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DeckSnapshot;
  destroy(): void;
}

/**
 * A live view of the deck as plain data. Only the slides a transaction touched are re-read, so typing in one
 * slide leaves every other slide's object identical and its thumbnail unrendered.
 */
export function createDeckStore(doc: Y.Doc): DeckStore {
  const cache = new Map<string, RenderSlide>();
  const deleted = new Map<string, string | null>();
  const listeners = new Set<() => void>();
  let dirty = new Set<string>();
  let all = true;
  let queued = false;
  let epoch = -1;
  let snapshot: DeckSnapshot;

  const read = (id: string) => {
    const slide = slidesMap(doc).get(id);
    cache.delete(id);
    deleted.delete(id);
    if (!slide) return;
    if (isDeleted(slide)) {
      const by = slide.get("deletedBy");
      deleted.set(id, typeof by === "string" ? by : null);
    } else cache.set(id, snapshotSlide(id, slide));
  };

  const rebuild = () => {
    queued = false;
    const fields = deckFields(doc);
    if (fields.epoch !== epoch) all = true;
    epoch = fields.epoch;
    if (all) {
      cache.clear();
      deleted.clear();
      slidesMap(doc).forEach((_s, id) => read(id));
    } else dirty.forEach(read);
    dirty = new Set();
    all = false;
    snapshot = {
      ...fields,
      slides: [...cache.values()].sort(comparePos),
      deletedIds: [...deleted.keys()],
      deletedBy: Object.fromEntries(deleted),
    };
    listeners.forEach((l) => l());
  };

  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(rebuild);
  };

  const onSlides = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    for (const event of events) {
      if (event.path.length === 0) (event as Y.YMapEvent<unknown>).keysChanged.forEach((k) => dirty.add(k));
      else dirty.add(String(event.path[0]));
    }
    schedule();
  };
  const onDeck = () => schedule();

  slidesMap(doc).observeDeep(onSlides);
  deckMap(doc).observe(onDeck);
  rebuild();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    destroy() {
      slidesMap(doc).unobserveDeep(onSlides);
      deckMap(doc).unobserve(onDeck);
      listeners.clear();
    },
  };
}
