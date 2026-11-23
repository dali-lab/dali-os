import type * as Y from "yjs";
import { McpError } from "../../errors";
import { blocksToFragment, plainTextToBlocks, type DocBlock } from "~/collab/blocknote-server";
import { markdownToRichDoc } from "~/components/slides/slide-markdown.server";
import { addSlide, ensureLayoutSlots, moveSlide, notesFragment, setLayout, setSlotImage, slideFragment, visibleSlideIds } from "~/components/slides/deck/deck-ops";
import { LAYOUTS, layoutById } from "~/components/slides/deck/layouts";
import { slidesMap } from "~/components/slides/deck/model";
import { MAX_HTML_CHARS } from "~/components/slides/deck/content";
import { ELEMENT_INPUT_SCHEMA, HTML_NOTE, LAYOUT_IDS, checkNewElement, placeNewElement, type ElementInput } from "./slide-deck-elements";

export const MAX_OUTLINE_SLIDES = 60;
export const MAX_OUTLINE_ELEMENTS = 30;

export const OUTLINE_SLIDE_SCHEMA = {
  type: "object" as const,
  properties: {
    layoutId: { type: "string", enum: LAYOUT_IDS, description: "Defaults to 'content'. update_slide keeps the slide's layout when this is left out." },
    slots: {
      type: "object",
      description: "Text for the layout's boxes, by slot name (title, subtitle, body and so on). Text is Markdown. An image box takes an object { src, alt } instead of text.",
      additionalProperties: true,
    },
    html: { type: "string", maxLength: MAX_HTML_CHARS, description: `A custom slide: this HTML fills a Blank-layout slide. layoutId and slots are not used with it. ${HTML_NOTE}` },
    notes: { type: "string", maxLength: 20_000, description: "Speaker notes." },
    elements: { type: "array", maxItems: MAX_OUTLINE_ELEMENTS, items: ELEMENT_INPUT_SCHEMA, description: "Free elements to add to the slide, each as in manage_slide_elements add_element." },
  },
  additionalProperties: false,
};

export type OutlineSlot = string | { src: string; alt?: string };

export interface OutlineSlide {
  layoutId?: string;
  slots?: Record<string, OutlineSlot>;
  html?: string;
  notes?: string;
  elements?: ElementInput[];
}

interface PreparedFields {
  text: Array<{ slot: string; blocks: DocBlock[] }>;
  images: Array<{ src: string; alt: string }>;
  elements: Array<{ input: ElementInput; blocks: DocBlock[] | null }>;
}

interface PreparedSlide extends PreparedFields {
  layoutId: string;
  notes: DocBlock[] | null;
}

export interface PreparedUpdate extends PreparedFields {
  layoutId: string;
  notes: DocBlock[] | undefined;
}

const invalid = (message: string) => new McpError(message, 400);

async function prepareFields(slide: OutlineSlide, layoutId: string, where: string, extraInputs: ElementInput[] = []): Promise<PreparedFields> {
  const layout = layoutById(layoutId);
  const text: PreparedFields["text"] = [];
  const images: PreparedFields["images"] = [];
  for (const [slot, value] of Object.entries(slide.slots ?? {})) {
    const def = layout.slots.find((s) => s.slot === slot);
    if (!def) throw invalid(`${where}: the ${layoutId} layout has no '${slot}' box. It has: ${layout.slots.map((s) => s.slot).join(", ")}.`);
    if (def.kind === "text") {
      if (typeof value !== "string") throw invalid(`${where}: '${slot}' takes text.`);
      text.push({ slot, blocks: (await markdownToRichDoc(value)) as unknown as DocBlock[] });
    } else {
      if (typeof value === "string" || !value?.src) throw invalid(`${where}: '${slot}' takes { src, alt }.`);
      if (!/^https?:\/\//i.test(value.src) && !/^\/(?!\/)/.test(value.src)) throw invalid(`${where}: image src must be an http(s) URL or a path on this site.`);
      images.push({ src: value.src, alt: value.alt ?? "" });
    }
  }
  const elements: PreparedFields["elements"] = [];
  for (const input of [...extraInputs, ...(slide.elements ?? [])]) {
    try {
      checkNewElement(input);
    } catch (err) {
      throw err instanceof McpError ? invalid(`${where}: ${err.message}`) : err;
    }
    elements.push({ input, blocks: input.markdown === undefined ? null : ((await markdownToRichDoc(input.markdown)) as unknown as DocBlock[]) });
  }
  return { text, images, elements };
}

/** Checks every slide and converts its Markdown, so nothing is written unless the whole outline is valid. */
export async function prepareOutline(outline: OutlineSlide[]): Promise<PreparedSlide[]> {
  if (outline.length === 0) throw invalid("Give at least one slide.");
  if (outline.length > MAX_OUTLINE_SLIDES) throw invalid(`An outline takes at most ${MAX_OUTLINE_SLIDES} slides.`);
  const prepared: PreparedSlide[] = [];
  for (const [i, slide] of outline.entries()) {
    const where = `Slide ${i + 1}`;
    if (slide.html !== undefined && slide.layoutId !== undefined && slide.layoutId !== "blank") throw invalid(`${where}: a slide with html uses the blank layout.`);
    if (slide.html !== undefined && Object.keys(slide.slots ?? {}).length > 0) throw invalid(`${where}: a slide with html has no boxes for slots.`);
    const layoutId = slide.html !== undefined ? "blank" : (slide.layoutId ?? "content");
    if (!LAYOUTS.some((l) => l.id === layoutId)) throw invalid(`${where}: layoutId must be one of: ${LAYOUT_IDS.join(", ")}.`);
    const htmlInput: ElementInput[] = slide.html !== undefined ? [{ kind: "html", html: slide.html, htmlFill: true }] : [];
    const fields = await prepareFields(slide, layoutId, where, htmlInput);
    prepared.push({ layoutId, ...fields, notes: slide.notes ? plainTextToBlocks(slide.notes) : null });
  }
  return prepared;
}

/** Checks one slide's changes against the slide it applies to. Fields left out are kept. */
export async function prepareSlideUpdate(slide: OutlineSlide, currentLayoutId: string): Promise<PreparedUpdate> {
  if (slide.html !== undefined) throw invalid("update_slide doesn't take html. Add or edit a custom HTML element with manage_slide_elements.");
  const layoutId = slide.layoutId ?? currentLayoutId;
  if (!LAYOUTS.some((l) => l.id === layoutId)) throw invalid(`layoutId must be one of: ${LAYOUT_IDS.join(", ")}.`);
  const fields = await prepareFields(slide, layoutId, "The slide");
  return { layoutId, ...fields, notes: slide.notes === undefined ? undefined : slide.notes ? plainTextToBlocks(slide.notes) : [] };
}

function replaceFragment(fragment: Y.XmlFragment, blocks: DocBlock[]): void {
  if (blocks.length > 0) blocksToFragment(blocks, fragment);
  else if (fragment.length > 0) fragment.delete(0, fragment.length);
}

/** Applies prepared changes to an existing slide: layout, the boxes and notes that were given, and any new free elements. */
export function writeSlideUpdate(doc: Y.Doc, slideId: string, prepared: PreparedUpdate): void {
  const live = slidesMap(doc).get(slideId)!;
  if (prepared.layoutId !== String(live.get("layoutId"))) setLayout(doc, slideId, prepared.layoutId);
  if (prepared.text.length > 0 || prepared.images.length > 0) ensureLayoutSlots(live, prepared.layoutId, true);
  for (const { slot, blocks } of prepared.text) {
    const fragment = slideFragment(doc, slideId, slot);
    if (fragment) replaceFragment(fragment, blocks);
  }
  for (const image of prepared.images) setSlotImage(doc, slideId, image.src, image.alt);
  const notes = notesFragment(doc, slideId);
  if (notes && prepared.notes !== undefined) replaceFragment(notes, prepared.notes);
  for (const { input, blocks } of prepared.elements) placeNewElement(doc, slideId, live, input, blocks);
}

/** Adds the prepared slides after the slide at `index - 1` (the end when `index` is left out). Returns the new slide ids in order. */
export function writeOutline(doc: Y.Doc, prepared: PreparedSlide[], index?: number): string[] {
  const order = visibleSlideIds(doc);
  const at = index === undefined ? order.length : Math.min(Math.max(Math.trunc(index), 0), order.length);
  let after: string | null = at > 0 ? order[at - 1] : null;
  const ids: string[] = [];
  for (const slide of prepared) {
    const id = addSlide(doc, slide.layoutId, after);
    if (after === null && order.length > 0) moveSlide(doc, id, 0);
    for (const { slot, blocks } of slide.text) {
      const fragment = slideFragment(doc, id, slot);
      if (fragment && blocks.length > 0) blocksToFragment(blocks, fragment);
    }
    for (const image of slide.images) setSlotImage(doc, id, image.src, image.alt);
    const notes = notesFragment(doc, id);
    if (notes && slide.notes) blocksToFragment(slide.notes, notes);
    const live = slidesMap(doc).get(id)!;
    for (const { input, blocks } of slide.elements) placeNewElement(doc, id, live, input, blocks);
    ids.push(id);
    after = id;
  }
  return ids;
}
