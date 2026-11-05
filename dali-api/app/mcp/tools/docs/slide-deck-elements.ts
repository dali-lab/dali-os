import * as Y from "yjs";
import { McpError } from "../../errors";
import { prisma } from "~/lib/db.server";
import { migrateDeckOnOpen, readDeckModel } from "~/lib/slide-decks.server";
import { transactDeck } from "~/collab/deck-live.server";
import { blocksToFragment, type DocBlock } from "~/collab/blocknote-server";
import type { DeckRead, DeckReadSlide } from "~/collab/read-deck.server";
import { slidesRoomName } from "~/collab/roomName";
import { getFrontendUrl } from "~/lib/app-env";
import { markdownToRichDoc, richDocToMarkdown } from "~/components/slides/slide-markdown.server";
import { LAYOUTS } from "~/components/slides/deck/layouts";
import { THEMES, TEXT_STYLE_IDS, type TextStyleId } from "~/components/slides/deck/themes";
import {
  FILL_IDS,
  SHAPE_KINDS,
  elementsOf,
  isDeleted,
  slidesMap,
  textOf,
  type ElementMap,
  type FillId,
  type ShapeKind,
  type SlideMap,
} from "~/components/slides/deck/model";
import { duplicateSlide, setBuild, setBuildBullets, setLayout, setSlotImage, setThemeId } from "~/components/slides/deck/deck-ops";
import {
  addFreeImage,
  addShape,
  addTextBox,
  alignElements,
  deleteElements,
  distributeElements,
  duplicateElements,
  groupElements,
  minSizeFor,
  placementsOf,
  reorderElements,
  setFill,
  setImageSource,
  setPlacements,
  snapBack,
  ungroupElements,
  type ReorderDirection,
} from "~/components/slides/deck/freeform-ops";
import { placementOf, type Placed } from "~/components/slides/deck/freeform";
import type { AlignMode, Axis } from "~/components/slides/deck/geometry";
import type { RenderElement } from "~/components/slides/deck/snapshot";

export const DECK_ACTIONS = [
  "set_theme",
  "set_layout",
  "duplicate_slide",
  "add_element",
  "update_element",
  "delete_elements",
  "duplicate_elements",
  "reorder_elements",
  "group_elements",
  "ungroup_elements",
  "align_elements",
  "distribute_elements",
  "snap_back",
] as const;
export type DeckAction = (typeof DECK_ACTIONS)[number];

export const LAYOUT_IDS = LAYOUTS.map((l) => l.id);
export const THEME_IDS = THEMES.map((t) => t.id);
const ALIGN_MODES: AlignMode[] = ["left", "center", "right", "top", "middle", "bottom"];
const REORDER: ReorderDirection[] = ["forward", "backward", "front", "back"];
const DEFAULT_STYLE = "default";

export const ELEMENT_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    kind: { type: "string", enum: ["text", "image", "shape"], description: "add_element only." },
    shape: { type: "string", enum: [...SHAPE_KINDS], description: "Shapes: required when adding one." },
    fill: { type: "string", enum: [...FILL_IDS], description: "Shapes: a theme color." },
    markdown: { type: "string", maxLength: 20_000, description: "Text: the whole text, replacing what is there." },
    textStyle: { type: "string", enum: [...TEXT_STYLE_IDS, DEFAULT_STYLE], description: "Text: a theme text style. 'default' goes back to the layout's style." },
    src: { type: "string", maxLength: 2_000, description: "Images: an http(s) URL or a path on this site. Required when adding one." },
    alt: { type: "string", maxLength: 300 },
    x: { type: "number", description: "Left edge on the 1920 by 1080 stage." },
    y: { type: "number", description: "Top edge on the stage." },
    w: { type: "number", description: "Width on the stage." },
    h: { type: "number", description: "Height on the stage." },
    rot: { type: "number", description: "Rotation in degrees." },
    build: { type: "integer", minimum: 0, maximum: 50, description: "The presenting step it appears at. 0 shows it from the start." },
    buildBullets: { type: "boolean", description: "Text: show its top-level blocks one per step after its own build step." },
  },
  additionalProperties: false,
};

export type ElementInput = {
  kind?: "text" | "image" | "shape";
  shape?: ShapeKind;
  fill?: FillId;
  markdown?: string;
  textStyle?: TextStyleId | typeof DEFAULT_STYLE;
  src?: string;
  alt?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rot?: number;
  build?: number;
  buildBullets?: boolean;
};

export type DeckArgs = {
  pageId: string;
  slideId?: string;
  themeId?: string;
  layoutId?: string;
  element?: ElementInput;
  elementId?: string;
  elementIds?: string[];
  direction?: ReorderDirection;
  align?: AlignMode;
  relativeTo?: "slide" | "selection";
  axis?: Axis;
};

const invalid = (message: string) => new McpError(message, 400);

async function elementView(layoutId: string, el: DeckReadSlide["elements"][number], groupOf: Map<string, string>) {
  const placed = el.kind === "group" ? null : placementOf(layoutId, el as unknown as RenderElement);
  return {
    id: el.id,
    kind: el.kind,
    slot: el.slot,
    z: el.z,
    ...(groupOf.has(el.id) ? { groupId: groupOf.get(el.id) } : {}),
    ...(el.children ? { children: el.children } : {}),
    ...(el.kind === "text" ? { markdown: await richDocToMarkdown(el.blocks as never) } : {}),
    ...(el.kind === "text" && el.textStyle ? { textStyle: el.textStyle } : {}),
    ...(el.kind === "image" ? { src: el.src ?? "", alt: el.alt ?? "" } : {}),
    ...(el.shape ? { shape: el.shape } : {}),
    ...(el.fill ? { fill: el.fill } : {}),
    ...(placed ? { x: placed.x, y: placed.y, w: placed.w, h: placed.h, rot: placed.rot } : {}),
    ...(el.slot !== null && el.x !== undefined ? { detached: true } : {}),
    ...(el.build ? { build: el.build } : {}),
    ...(el.buildBullets ? { buildBullets: true } : {}),
  };
}

export async function slideView(slide: DeckReadSlide) {
  const groupOf = new Map<string, string>();
  for (const el of slide.elements) for (const child of el.children ?? []) groupOf.set(child, el.id);
  return {
    id: slide.id,
    layoutId: slide.layoutId,
    elements: await Promise.all(slide.elements.map((el) => elementView(slide.layoutId, el, groupOf))),
  };
}

/** The live-model fields `get` adds when asked for elements. */
export async function deckModelView(pageId: string, slideIds: string[]) {
  const read = await readDeckModel(pageId);
  const byId = new Map(read.slides.map((s) => [s.id, s]));
  const slides = await Promise.all(slideIds.map(async (id) => (byId.has(id) ? slideView(byId.get(id)!) : null)));
  return { themeId: read.themeId, docName: slidesRoomName(pageId), slides };
}

export function exportLinks(pageId: string, canEdit: boolean) {
  const base = `${getFrontendUrl().replace(/\/+$/, "")}/slides/${encodeURIComponent(pageId)}`;
  return {
    pdfUrl: `${base}/export.pdf`,
    ...(canEdit ? { pdfWithNotesUrl: `${base}/export.pdf?notes=1` } : {}),
    pptxUrl: `${base}/export.pptx`,
  };
}

function liveSlide(doc: Y.Doc, slideId: string | undefined): SlideMap {
  const slide = slideId ? slidesMap(doc).get(slideId) : undefined;
  if (!slide || isDeleted(slide)) throw new McpError("Slide not found.", 404);
  return slide;
}

function liveElement(slide: SlideMap, id: string): ElementMap {
  const el = elementsOf(slide).get(id);
  if (!el || isDeleted(el)) throw new McpError(`Element '${id}' not found.`, 404);
  return el;
}

function checkImageSrc(src: string): void {
  if (!/^https?:\/\//i.test(src) && !/^\/(?!\/)/.test(src)) throw invalid("Image src must be an http(s) URL or a path on this site.");
}

const GEOMETRY = ["x", "y", "w", "h", "rot"] as const;
const hasGeometry = (e: ElementInput) => GEOMETRY.some((k) => e[k] !== undefined);

/** Throws before any write when a field doesn't fit the element it targets. */
function checkFields(kind: string, el: ElementMap | null, e: ElementInput, shape: string | null): void {
  if (e.markdown !== undefined && kind !== "text") throw invalid("Only text elements take markdown.");
  if (e.textStyle !== undefined && kind !== "text") throw invalid("Only text elements take a text style.");
  if (e.buildBullets !== undefined && kind !== "text") throw invalid("Only text elements build bullet by bullet.");
  if ((e.src !== undefined || e.alt !== undefined) && kind !== "image") throw invalid("Only image elements take src and alt.");
  if (e.src !== undefined) checkImageSrc(e.src);
  if (e.fill !== undefined && kind !== "shape") throw invalid("Only shapes take a fill.");
  if (e.shape !== undefined && el) throw invalid("A shape's kind is set when it is added.");
  if (hasGeometry(e) && kind === "group") throw invalid("Move a group's items, not the group.");
  for (const k of GEOMETRY) if (e[k] !== undefined && !Number.isFinite(e[k])) throw invalid(`${k} must be a number.`);
  if (e.kind !== undefined && el) throw invalid("An element's kind is set when it is added.");
  if (e.fill !== undefined && !FILL_IDS.includes(e.fill)) throw invalid(`fill must be one of: ${FILL_IDS.join(", ")}.`);
  if (e.textStyle !== undefined && e.textStyle !== DEFAULT_STYLE && !TEXT_STYLE_IDS.includes(e.textStyle)) {
    throw invalid(`textStyle must be one of: ${[...TEXT_STYLE_IDS, DEFAULT_STYLE].join(", ")}.`);
  }
  if (shape !== null && !el && !SHAPE_KINDS.includes(shape as ShapeKind)) throw invalid(`shape must be one of: ${SHAPE_KINDS.join(", ")}.`);
  const min = minSizeFor(shape);
  if ((e.w !== undefined && e.w < min.w) || (e.h !== undefined && e.h < min.h)) throw invalid(`The smallest size is ${min.w} by ${min.h}.`);
}

function nextPlacement(doc: Y.Doc, slideId: string, id: string, e: ElementInput): Placed | null {
  if (!hasGeometry(e)) return null;
  const next: Partial<Placed> = { ...placementsOf(doc, slideId, [id]).get(id) };
  for (const k of GEOMETRY) if (e[k] !== undefined) next[k] = e[k];
  if (next.x === undefined || next.y === undefined || next.w === undefined || next.h === undefined) {
    throw invalid("This element has no place on the slide yet: give x, y, w and h.");
  }
  return { x: next.x, y: next.y, w: next.w, h: next.h, rot: next.rot ?? 0 };
}

function writeFields(doc: Y.Doc, slideId: string, slide: SlideMap, id: string, e: ElementInput, blocks: DocBlock[] | null): void {
  const el = liveElement(slide, id);
  const kind = String(el.get("kind"));
  const placed = nextPlacement(doc, slideId, id, e);
  if (blocks) {
    let frag = textOf(slide).get(id);
    if (!frag) {
      frag = new Y.XmlFragment();
      textOf(slide).set(id, frag);
    }
    if (blocks.length > 0) blocksToFragment(blocks, frag);
    else if (frag.length > 0) frag.delete(0, frag.length);
  }
  if (e.textStyle !== undefined) el.set("textStyle", e.textStyle === DEFAULT_STYLE ? null : e.textStyle);
  if (kind === "image" && (e.src !== undefined || e.alt !== undefined)) {
    const src = e.src ?? String(el.get("src") ?? "");
    const alt = e.alt ?? String(el.get("alt") ?? "");
    if (typeof el.get("slot") === "string") setSlotImage(doc, slideId, src, alt);
    else setImageSource(doc, slideId, id, src, alt);
  }
  if (e.fill !== undefined) setFill(doc, slideId, [id], e.fill);
  if (placed) setPlacements(doc, slideId, { [id]: placed });
  if (e.build !== undefined) setBuild(doc, slideId, id, e.build || null);
  if (e.buildBullets !== undefined) setBuildBullets(doc, slideId, id, e.buildBullets);
}

function addElement(doc: Y.Doc, slideId: string, e: ElementInput): string {
  if (e.kind === "image") {
    if (!e.src) throw invalid("Adding an image needs src.");
    return addFreeImage(doc, slideId, e.src, e.alt ?? "")!;
  }
  if (e.kind === "shape") {
    if (!e.shape) throw invalid("Adding a shape needs shape.");
    return addShape(doc, slideId, e.shape, undefined, e.fill ?? "accent")!;
  }
  return addTextBox(doc, slideId)!;
}

function idsOf(slide: SlideMap, args: DeckArgs, min: number): string[] {
  const ids = [...new Set(args.elementIds ?? [])];
  if (ids.length < min) throw invalid(`This action needs at least ${min} element${min === 1 ? "" : "s"}.`);
  for (const id of ids) liveElement(slide, id);
  return ids;
}

type Outcome = { slideId?: string; created?: Record<string, unknown> };

function apply(doc: Y.Doc, action: DeckAction, args: DeckArgs, blocks: DocBlock[] | null): Outcome {
  if (action === "set_theme") {
    if (!THEME_IDS.includes(args.themeId!)) throw invalid(`themeId must be one of: ${THEME_IDS.join(", ")}.`);
    setThemeId(doc, args.themeId!);
    return {};
  }
  const slide = liveSlide(doc, args.slideId);
  const slideId = args.slideId!;
  switch (action) {
    case "set_layout":
      if (!LAYOUT_IDS.includes(args.layoutId!)) throw invalid(`layoutId must be one of: ${LAYOUT_IDS.join(", ")}.`);
      setLayout(doc, slideId, args.layoutId!);
      return { slideId };
    case "duplicate_slide": {
      const copy = duplicateSlide(doc, slideId)!;
      return { slideId: copy, created: { slideId: copy } };
    }
    case "add_element": {
      const e = args.element!;
      if (!e.kind) throw invalid("add_element needs element.kind.");
      if (e.shape !== undefined && e.kind !== "shape") throw invalid("Only shapes take a shape kind.");
      checkFields(e.kind, null, { ...e, kind: undefined, shape: undefined }, e.shape ?? null);
      const id = addElement(doc, slideId, e);
      writeFields(doc, slideId, slide, id, { ...e, src: undefined, alt: undefined, fill: undefined }, blocks);
      return { slideId, created: { elementId: id } };
    }
    case "update_element": {
      const el = liveElement(slide, args.elementId!);
      const shape = el.get("shape");
      checkFields(String(el.get("kind")), el, args.element!, typeof shape === "string" ? shape : null);
      writeFields(doc, slideId, slide, args.elementId!, args.element!, blocks);
      return { slideId };
    }
    case "delete_elements":
      return { slideId, created: { removed: deleteElements(doc, slideId, idsOf(slide, args, 1)) } };
    case "duplicate_elements":
      return { slideId, created: { elementIds: duplicateElements(doc, slideId, idsOf(slide, args, 1)) } };
    case "reorder_elements":
      if (!REORDER.includes(args.direction!)) throw invalid(`direction must be one of: ${REORDER.join(", ")}.`);
      reorderElements(doc, slideId, idsOf(slide, args, 1), args.direction!);
      return { slideId };
    case "group_elements": {
      const groupId = groupElements(doc, slideId, idsOf(slide, args, 2));
      if (!groupId) throw invalid("Group needs at least two items that aren't already one group.");
      return { slideId, created: { groupId } };
    }
    case "ungroup_elements":
      return { slideId, created: { elementIds: ungroupElements(doc, slideId, idsOf(slide, args, 1)) } };
    case "align_elements": {
      if (!ALIGN_MODES.includes(args.align!)) throw invalid(`align must be one of: ${ALIGN_MODES.join(", ")}.`);
      const ids = idsOf(slide, args, 1);
      const to = args.relativeTo ?? (ids.length > 1 ? "selection" : "slide");
      if (to === "selection" && ids.length < 2) throw invalid("Aligning to the selection needs at least two elements.");
      alignElements(doc, slideId, ids, args.align!, to);
      return { slideId };
    }
    case "distribute_elements":
      if (args.axis !== "x" && args.axis !== "y") throw invalid("axis must be x or y.");
      distributeElements(doc, slideId, idsOf(slide, args, 3), args.axis);
      return { slideId };
    case "snap_back":
      snapBack(doc, slideId, idsOf(slide, args, 1));
      return { slideId };
  }
}

/** Runs one live-model action on the deck through the collab room, so open editors see it at once. */
export async function runDeckAction(userId: string, action: DeckAction, args: DeckArgs) {
  if ((await migrateDeckOnOpen(userId, args.pageId)) !== "yjs") {
    throw invalid("This deck still uses the older slides editor, which can't do that. Ask an admin to turn on the live deck editor.");
  }
  const markdown = args.element?.markdown;
  const blocks = markdown === undefined ? null : ((await markdownToRichDoc(markdown)) as unknown as DocBlock[]);
  let outcome: Outcome = {};
  await transactDeck(args.pageId, userId, (doc) => {
    outcome = apply(doc, action, args, blocks);
  });
  await prisma.page.update({ where: { id: args.pageId }, data: { lastEditedById: userId } });
  const read: DeckRead = await readDeckModel(args.pageId);
  const slide = outcome.slideId ? read.slides.find((s) => s.id === outcome.slideId) : undefined;
  return {
    themeId: read.themeId,
    ...(outcome.created ?? {}),
    ...(slide ? { slide: await slideView(slide) } : {}),
  };
}
