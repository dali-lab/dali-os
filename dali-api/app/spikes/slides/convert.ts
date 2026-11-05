import * as Y from "yjs";
import { blocksToFragment, plainTextToBlocks } from "~/collab/blocknote-server";
import type { Slide, SlideLayout } from "~/components/slides/types";
import { addSlide, initDeck, slidesMap, LOCAL_ORIGIN } from "./deck-model";

const LAYOUT_IDS: Record<SlideLayout, string> = { title: "title", content: "content", split: "split", image: "image" };

/** Writes the legacy deck into `doc`. Element ids are fixed per slot so the same JSON always means the same keys. */
export function seedDeckDoc(doc: Y.Doc, slides: Slide[]): void {
  doc.transact(() => {
    initDeck(doc);
    slides.forEach((s, i) => {
      const slide = addSlide(doc, s.id, i + 1, LAYOUT_IDS[s.layout] ?? "content");
      const elements = slide.get("elements") as Y.Map<Y.Map<unknown>>;
      const text = slide.get("text") as Y.Map<Y.XmlFragment>;
      const addText = (elId: string, slot: string, z: number, write: (f: Y.XmlFragment) => void) => {
        const el = new Y.Map<unknown>();
        elements.set(elId, el);
        el.set("id", elId);
        el.set("kind", "text");
        el.set("slot", slot);
        el.set("z", z);
        const frag = new Y.XmlFragment();
        text.set(elId, frag);
        write(frag);
      };
      if (s.title) addText("title", "title", 1, (f) => blocksToFragment(plainTextToBlocks(s.title), f));
      if (s.subtitle) addText("subtitle", "subtitle", 2, (f) => blocksToFragment(plainTextToBlocks(s.subtitle!), f));
      if (s.body && s.body.length) addText("body", "body", 3, (f) => blocksToFragment(s.body as never, f));
      if (s.image) {
        const el = new Y.Map<unknown>();
        elements.set("image", el);
        el.set("id", "image");
        el.set("kind", "image");
        el.set("slot", "image");
        el.set("z", 4);
        el.set("src", s.image.src);
        el.set("alt", s.image.alt);
      }
      if (s.notes) blocksToFragment(plainTextToBlocks(s.notes), slide.get("notes") as Y.XmlFragment);
    });
  }, LOCAL_ORIGIN);
}

export interface ConversionStore {
  /** Runs fn holding the per-name lock (pg_advisory_xact_lock(hashtext(name)) in a transaction). */
  withLock<T>(name: string, fn: (tx: ConversionTx) => Promise<T>): Promise<T>;
}
export interface ConversionTx {
  getState(name: string): Promise<Uint8Array | null>;
  putState(name: string, state: Uint8Array): Promise<void>;
  /** CAS json -> yjs; true if this call flipped it. */
  flipStorage(name: string): Promise<boolean>;
}

/** Convert-on-first-open. Random clientID (Y.Doc default); the lock plus the re-check make one winner. */
export async function loadOrConvertDeck(
  store: ConversionStore,
  name: string,
  readLegacy: () => Promise<Slide[]>,
  opts: { skipRecheck?: boolean; beforeWrite?: () => Promise<void> } = {},
): Promise<{ state: Uint8Array; converted: boolean }> {
  return store.withLock(name, async (tx) => {
    if (!opts.skipRecheck) {
      const existing = await tx.getState(name);
      if (existing) return { state: existing, converted: false };
    }
    const doc = new Y.Doc();
    seedDeckDoc(doc, await readLegacy());
    await opts.beforeWrite?.();
    const state = Y.encodeStateAsUpdate(doc);
    await tx.putState(name, state);
    await tx.flipStorage(name);
    return { state, converted: true };
  });
}

export function slideCount(state: Uint8Array): number {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return slidesMap(doc).size;
}
