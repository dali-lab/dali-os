import * as Y from "yjs";
import { DECK_CREATE, ensureLayoutSlots, newId, visibleSlideIds } from "~/components/slides/deck/deck-ops";
import { elementsOf, newElementMap, newSlideMap, notesOf, slidesMap, textOf, type ElementMap } from "~/components/slides/deck/model";
import { layoutById } from "~/components/slides/deck/layouts";
import { paragraphsOf, writeBlocks } from "./fragment-write";
import type { ImportPlacement, ReadyFree, ReadySlide } from "./import-types";

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

function writePlacement(el: ElementMap, p: ImportPlacement): void {
  el.set("x", p.x);
  el.set("y", p.y);
  el.set("w", p.w);
  el.set("h", p.h);
  el.set("rot", p.rot);
  el.set("z", p.z);
}

function addFree(slide: ReturnType<typeof newSlideMap>, item: ReadyFree): void {
  const id = newId();
  const z = item.placed.z;
  let el: ElementMap;
  if (item.kind === "text") {
    el = newElementMap(id, "text", z, { textStyle: item.textStyle });
    const fragment = new Y.XmlFragment();
    textOf(slide).set(id, fragment);
    writeBlocks(fragment, item.blocks);
  } else if (item.kind === "image") el = newElementMap(id, "image", z, { src: item.src, alt: item.alt });
  else el = newElementMap(id, "shape", z, { shape: item.shape, fill: item.fill });
  writePlacement(el, item.placed);
  elementsOf(slide).set(id, el);
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
      for (const [slot, placed] of Object.entries(plan.placements ?? {})) {
        const el = elementsOf(slide).get(slot);
        if (el && placed) writePlacement(el, placed);
      }
      for (const item of plan.free ?? []) addFree(slide, item);
      writeBlocks(notesOf(slide), paragraphsOf(plan.notes));
      ids.push(id);
    });
  }, DECK_CREATE);
  return ids;
}
