import type * as Y from "yjs";
import { DECK_CREATE, ensureLayoutSlots, newId, visibleSlideIds } from "~/components/slides/deck/deck-ops";
import { elementsOf, newSlideMap, notesOf, slidesMap, textOf } from "~/components/slides/deck/model";
import { layoutById } from "~/components/slides/deck/layouts";
import { paragraphsOf, writeBlocks } from "./fragment-write";
import type { ReadySlide } from "./import-types";

export const CHUNK_BYTES = 500_000;

const sizeOf = (slide: ReadySlide): number => JSON.stringify(slide).length;

/** Groups slides in order so each group stays near `maxBytes`. A slide over the limit still goes in, alone. */
export function chunkSlides(slides: ReadySlide[], maxBytes = CHUNK_BYTES): ReadySlide[][] {
  const chunks: ReadySlide[][] = [];
  let current: ReadySlide[] = [];
  let bytes = 0;
  for (const slide of slides) {
    const size = sizeOf(slide);
    if (current.length > 0 && bytes + size > maxBytes) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(slide);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Adds slides after the last visible one in a single transaction that undo does not track, and returns their ids. */
export function appendSlides(doc: Y.Doc, slides: ReadySlide[]): string[] {
  const ids: string[] = [];
  const map = slidesMap(doc);
  doc.transact(() => {
    const visible = visibleSlideIds(doc);
    const last = visible.length ? Number(map.get(visible[visible.length - 1])!.get("pos")) : 0;
    slides.forEach((plan, i) => {
      const id = newId();
      const layout = layoutById(plan.layoutId);
      const slide = newSlideMap(id, last + i + 1, layout.id);
      map.set(id, slide);
      ensureLayoutSlots(slide, layout.id);
      const fragments = textOf(slide);
      const content = { title: plan.title, subtitle: plan.subtitle, body: plan.body };
      for (const [slot, blocks] of Object.entries(content)) {
        const fragment = fragments.get(slot);
        if (fragment) writeBlocks(fragment, blocks);
      }
      const image = elementsOf(slide).get("image");
      if (image && plan.image) {
        image.set("src", plan.image.src);
        image.set("alt", plan.image.alt);
      }
      writeBlocks(notesOf(slide), paragraphsOf(plan.notes));
      ids.push(id);
    });
  }, DECK_CREATE);
  return ids;
}
