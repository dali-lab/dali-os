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
  isRemovedSlot,
  reviveSlot,
  slidesMap,
  textOf,
  type ElementMap,
  type FillId,
  type ShapeKind,
  type SlideMap,
} from "~/components/slides/deck/model";
import { BUILD_EFFECTS, MAX_BUILD_DELAY, type BuildEffect } from "~/components/slides/deck/builds";
import { duplicateSlide, setBuild, setBuildBullets, setBuildEffect, setBuildTiming, setLayout, setSlotImage, setThemeId } from "~/components/slides/deck/deck-ops";
import {
  addChart,
  addFreeImage,
  addHtml,
  addIcon,
  addPoll,
  addShape,
  addTextBox,
  addVideo,
  alignElements,
  deleteElements,
  distributeElements,
  duplicateElements,
  groupElements,
  minSizeFor,
  placementsOf,
  reorderElements,
  setChart,
  setFill,
  setHtmlFill,
  setHtmlSource,
  setImageSource,
  setPoll,
  setVideoUrl,
  setIconName,
  setPlacements,
  snapBack,
  ungroupElements,
  type ReorderDirection,
} from "~/components/slides/deck/freeform-ops";
import { placementOf, type Placed } from "~/components/slides/deck/freeform";
import { CHART_TYPES, cleanChart, cleanHtmlSource, cleanIcon, cleanPoll, cleanVideoUrl, MAX_CHART_CATEGORIES, MAX_CHART_SERIES, MAX_HTML_CHARS, MAX_POLL_OPTION, MAX_POLL_OPTIONS, MAX_POLL_QUESTION, MIN_POLL_OPTIONS, type ChartSpec, type PollSpec } from "~/components/slides/deck/content";
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

export const HTML_NOTE =
  "Custom HTML (kind 'html'): html is the page's markup, CSS and script as one string, up to 200000 characters. It runs in a sandboxed frame laid out at the element's w by h in stage units, so 1px of your CSS is one stage unit; a full slide is 1920 by 1080. Set htmlFill: true to cover the whole slide (x, y, w, h are then ignored). Theme CSS variables are set on :root: --slide-accent, --slide-fg, --slide-muted, --slide-surface, --slide-ground, --slide-rule, --slide-font-display, --slide-font-body; html and body have no margin and are 100% tall. Network requests (fetch, XHR, WebSocket, forms) are blocked. Scripts run inline or from cdnjs.cloudflare.com, cdn.jsdelivr.net and unpkg.com only; images load over https or data:. It is not shared live between screens. PDF export prints what the frame shows after it loads; PowerPoint export turns it into a picture.";

export const HTML_PREVIEW_CHARS = 400;

export const ELEMENT_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    kind: { type: "string", enum: ["text", "image", "shape", "chart", "icon", "video", "poll", "html"], description: "add_element only. Tables and code go in a text element's markdown (a pipe table or a fenced block)." },
    shape: { type: "string", enum: [...SHAPE_KINDS], description: "Shapes: required when adding one." },
    fill: { type: "string", enum: [...FILL_IDS], description: "Shapes: a theme color." },
    markdown: { type: "string", maxLength: 20_000, description: "Text: the whole text, replacing what is there." },
    textStyle: { type: "string", enum: [...TEXT_STYLE_IDS, DEFAULT_STYLE], description: "Text: a theme text style. 'default' goes back to the layout's style." },
    src: { type: "string", maxLength: 2_000, description: "Images: an http(s) URL or a path on this site. Required when adding one." },
    alt: { type: "string", maxLength: 300 },
    chart: {
      type: "object",
      description: "Charts: required when adding one; on update it replaces the chart. Every series needs one value per label.",
      properties: {
        type: { type: "string", enum: [...CHART_TYPES] },
        labels: { type: "array", items: { type: "string", maxLength: 60 }, minItems: 1, maxItems: MAX_CHART_CATEGORIES },
        series: {
          type: "array",
          minItems: 1,
          maxItems: MAX_CHART_SERIES,
          items: {
            type: "object",
            properties: { name: { type: "string", maxLength: 60 }, values: { type: "array", items: { type: "number" }, maxItems: MAX_CHART_CATEGORIES } },
            required: ["name", "values"],
            additionalProperties: false,
          },
        },
      },
      required: ["type", "labels", "series"],
      additionalProperties: false,
    },
    icon: { type: "string", maxLength: 60, description: "Icons: a lucide icon name such as 'rocket' or 'bar-chart-3'. Required when adding one." },
    videoUrl: { type: "string", maxLength: 2_048, description: "Videos: a YouTube link. Required when adding one." },
    poll: {
      type: "object",
      description: "Polls: required when adding one. Followers vote while you present.",
      properties: {
        question: { type: "string", maxLength: MAX_POLL_QUESTION },
        options: { type: "array", items: { type: "string", maxLength: MAX_POLL_OPTION }, minItems: MIN_POLL_OPTIONS, maxItems: MAX_POLL_OPTIONS },
        multi: { type: "boolean", description: "Allow several answers." },
      },
      required: ["question", "options"],
      additionalProperties: false,
    },
    html: { type: "string", maxLength: MAX_HTML_CHARS, description: `Custom HTML: the source, replacing what is there. Required when adding one. ${HTML_NOTE}` },
    htmlFill: { type: "boolean", description: "Custom HTML: cover the whole slide." },
    x: { type: "number", description: "Left edge on the 1920 by 1080 stage." },
    y: { type: "number", description: "Top edge on the stage." },
    w: { type: "number", description: "Width on the stage." },
    h: { type: "number", description: "Height on the stage." },
    rot: { type: "number", description: "Rotation in degrees." },
    build: { type: "integer", minimum: 0, maximum: 50, description: "The presenting step it appears at. 0 shows it from the start." },
    buildBullets: { type: "boolean", description: "Text: show its top-level blocks one per step, the first together with the box." },
    buildEffect: { type: "string", enum: ["appear", "fade", "rise", "scale"], description: "How it enters while presenting. Fade when left out." },
    buildAfter: { type: "boolean", description: "Its step plays by itself after the previous step instead of waiting for a key press." },
    buildDelay: { type: "integer", minimum: 0, maximum: 5000, description: "Milliseconds to wait before an automatic step." },
  },
  additionalProperties: false,
};

export type ChartInput = { type: ChartSpec["type"]; labels: string[]; series: Array<{ name: string; values: number[] }> };

export type ElementInput = {
  kind?: "text" | "image" | "shape" | "chart" | "icon" | "video" | "poll" | "html";
  html?: string;
  htmlFill?: boolean;
  chart?: ChartInput;
  icon?: string;
  videoUrl?: string;
  poll?: PollSpec;
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
  buildEffect?: BuildEffect;
  buildAfter?: boolean;
  buildDelay?: number;
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

export interface ViewOptions {
  includeHtml?: boolean;
}

async function elementView(layoutId: string, el: DeckReadSlide["elements"][number], groupOf: Map<string, string>, opts: ViewOptions) {
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
    ...(el.chart ? { chart: { type: el.chart.type, labels: el.chart.data.labels, series: el.chart.data.series } } : {}),
    ...(el.icon ? { icon: el.icon } : {}),
    ...(el.videoUrl ? { videoUrl: el.videoUrl } : {}),
    ...(el.poll ? { poll: el.poll } : {}),
    ...(el.kind === "html" ? { htmlLength: (el.html ?? "").length, ...(opts.includeHtml ? { html: el.html ?? "" } : { htmlPreview: (el.html ?? "").slice(0, HTML_PREVIEW_CHARS) }), ...(el.htmlFill ? { htmlFill: true } : {}) } : {}),
    ...(el.shape ? { shape: el.shape } : {}),
    ...(el.fill ? { fill: el.fill } : {}),
    ...(placed ? { x: placed.x, y: placed.y, w: placed.w, h: placed.h, rot: placed.rot } : {}),
    ...(el.slot !== null && el.x !== undefined ? { detached: true } : {}),
    ...(el.build ? { build: el.build } : {}),
    ...(el.buildBullets ? { buildBullets: true } : {}),
    ...(el.buildEffect ? { buildEffect: el.buildEffect } : {}),
    ...(el.buildAfter ? { buildAfter: true } : {}),
    ...(el.buildDelay ? { buildDelay: el.buildDelay } : {}),
  };
}

export async function slideView(slide: DeckReadSlide, opts: ViewOptions = {}) {
  const groupOf = new Map<string, string>();
  for (const el of slide.elements) for (const child of el.children ?? []) groupOf.set(child, el.id);
  return {
    id: slide.id,
    layoutId: slide.layoutId,
    elements: await Promise.all(slide.elements.map((el) => elementView(slide.layoutId, el, groupOf, opts))),
  };
}

/** The live-model fields `get` adds when asked for elements. */
export async function deckModelView(pageId: string, slideIds: string[], opts: ViewOptions = {}) {
  const read = await readDeckModel(pageId);
  const byId = new Map(read.slides.map((s) => [s.id, s]));
  const slides = await Promise.all(slideIds.map(async (id) => (byId.has(id) ? slideView(byId.get(id)!, opts) : null)));
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

function liveElement(slide: SlideMap, id: string, allowRemovedSlot = false): ElementMap {
  const el = elementsOf(slide).get(id);
  if (!el || (isDeleted(el) && !(allowRemovedSlot && isRemovedSlot(el)))) throw new McpError(`Element '${id}' not found.`, 404);
  return el;
}

function chartSpecOf(chart: ChartInput): ChartSpec | null {
  return cleanChart({ type: chart.type, data: { labels: chart.labels, series: chart.series } });
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
  if (e.buildEffect !== undefined && !BUILD_EFFECTS.includes(e.buildEffect)) throw invalid(`buildEffect must be one of ${BUILD_EFFECTS.join(", ")}.`);
  if (e.buildDelay !== undefined && (!Number.isInteger(e.buildDelay) || e.buildDelay < 0 || e.buildDelay > MAX_BUILD_DELAY)) throw invalid(`buildDelay must be a whole number from 0 to ${MAX_BUILD_DELAY}.`);
  if (e.buildBullets !== undefined && kind !== "text") throw invalid("Only text elements build bullet by bullet.");
  if ((e.src !== undefined || e.alt !== undefined) && kind !== "image") throw invalid("Only image elements take src and alt.");
  if (e.src !== undefined) checkImageSrc(e.src);
  if (e.chart !== undefined && kind !== "chart") throw invalid("Only chart elements take chart data.");
  if (e.icon !== undefined && kind !== "icon") throw invalid("Only icon elements take an icon name.");
  if (e.videoUrl !== undefined && kind !== "video") throw invalid("Only video elements take a videoUrl.");
  if (e.poll !== undefined && kind !== "poll") throw invalid("Only poll elements take a poll.");
  if (e.chart !== undefined && !chartSpecOf(e.chart)) throw invalid(`chart needs a type (${CHART_TYPES.join(", ")}), up to ${MAX_CHART_CATEGORIES} labels and up to ${MAX_CHART_SERIES} series with numbers.`);
  if (e.icon !== undefined && !cleanIcon(e.icon)) throw invalid("That isn't an icon name. Use a lucide name such as 'rocket'.");
  if (e.videoUrl !== undefined && !cleanVideoUrl(e.videoUrl)) throw invalid("videoUrl must be a YouTube link.");
  if (e.poll !== undefined && !cleanPoll(e.poll)) throw invalid(`poll needs a question and ${MIN_POLL_OPTIONS} to ${MAX_POLL_OPTIONS} non-empty options.`);
  if ((e.html !== undefined || e.htmlFill !== undefined) && kind !== "html") throw invalid("Only html elements take html and htmlFill.");
  if (e.html !== undefined && (typeof e.html !== "string" || cleanHtmlSource(e.html) === null)) {
    throw invalid(`html must be text of at most ${MAX_HTML_CHARS} characters${typeof e.html === "string" ? ` (got ${e.html.length})` : ""}.`);
  }
  if (e.htmlFill !== undefined && typeof e.htmlFill !== "boolean") throw invalid("htmlFill must be true or false.");
  if (e.fill !== undefined && kind !== "shape" && kind !== "icon") throw invalid("Only shapes and icons take a fill.");
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
  if (e.chart !== undefined) setChart(doc, slideId, id, chartSpecOf(e.chart)!);
  if (e.icon !== undefined) setIconName(doc, slideId, id, e.icon);
  if (e.videoUrl !== undefined) setVideoUrl(doc, slideId, id, e.videoUrl);
  if (e.poll !== undefined) setPoll(doc, slideId, id, e.poll);
  if (e.html !== undefined) setHtmlSource(doc, slideId, id, e.html);
  if (e.htmlFill !== undefined) setHtmlFill(doc, slideId, id, e.htmlFill);
  if (placed) setPlacements(doc, slideId, { [id]: placed });
  if (e.build !== undefined) setBuild(doc, slideId, id, e.build || null);
  if (e.buildBullets !== undefined) setBuildBullets(doc, slideId, id, e.buildBullets);
  if (e.buildEffect !== undefined) setBuildEffect(doc, slideId, id, e.buildEffect);
  if (e.buildAfter !== undefined || e.buildDelay !== undefined) {
    const current = elementsOf(slidesMap(doc).get(slideId)!).get(id);
    setBuildTiming(doc, slideId, id, e.buildAfter ?? current?.get("buildAfter") === true, e.buildDelay ?? (current?.get("buildDelay") as number | undefined) ?? null);
  }
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
  if (e.kind === "chart") {
    if (!e.chart) throw invalid("Adding a chart needs chart.");
    return addChart(doc, slideId, e.chart.type)!;
  }
  if (e.kind === "icon") {
    if (!e.icon) throw invalid("Adding an icon needs icon.");
    return addIcon(doc, slideId, e.icon, undefined, e.fill ?? "accent")!;
  }
  if (e.kind === "video") {
    if (!e.videoUrl) throw invalid("Adding a video needs videoUrl.");
    return addVideo(doc, slideId, e.videoUrl)!;
  }
  if (e.kind === "poll") {
    if (!e.poll) throw invalid("Adding a poll needs poll.");
    return addPoll(doc, slideId, cleanPoll(e.poll)!)!;
  }
  if (e.kind === "html") {
    if (e.html === undefined) throw invalid("Adding custom HTML needs html.");
    return addHtml(doc, slideId, cleanHtmlSource(e.html)!, { fill: e.htmlFill === true })!;
  }
  return addTextBox(doc, slideId)!;
}

function idsOf(slide: SlideMap, args: DeckArgs, min: number, allowRemovedSlots = false): string[] {
  const ids = [...new Set(args.elementIds ?? [])];
  if (ids.length < min) throw invalid(`This action needs at least ${min} element${min === 1 ? "" : "s"}.`);
  for (const id of ids) liveElement(slide, id, allowRemovedSlots);
  return ids;
}

/** Throws before any write when `e` can't be added as a new element. */
export function checkNewElement(e: ElementInput): void {
  if (!e.kind) throw invalid("add_element needs element.kind.");
  if (e.shape !== undefined && e.kind !== "shape") throw invalid("Only shapes take a shape kind.");
  checkFields(e.kind, null, { ...e, kind: undefined, shape: undefined }, e.shape ?? null);
  if (e.kind === "image" && !e.src) throw invalid("Adding an image needs src.");
  if (e.kind === "shape" && !e.shape) throw invalid("Adding a shape needs shape.");
  if (e.kind === "chart" && !e.chart) throw invalid("Adding a chart needs chart.");
  if (e.kind === "icon" && !e.icon) throw invalid("Adding an icon needs icon.");
  if (e.kind === "video" && !e.videoUrl) throw invalid("Adding a video needs videoUrl.");
  if (e.kind === "poll" && !e.poll) throw invalid("Adding a poll needs poll.");
  if (e.kind === "html" && e.html === undefined) throw invalid("Adding custom HTML needs html.");
}

/** Adds a free element to a slide and returns its id. `blocks` is the text of a text element, already converted. */
export function placeNewElement(doc: Y.Doc, slideId: string, slide: SlideMap, e: ElementInput, blocks: DocBlock[] | null): string {
  checkNewElement(e);
  const id = addElement(doc, slideId, e);
  writeFields(doc, slideId, slide, id, { ...e, src: undefined, alt: undefined, fill: undefined, chart: e.kind === "chart" ? e.chart : undefined, icon: undefined, videoUrl: undefined, poll: undefined, html: undefined, htmlFill: undefined }, blocks);
  return id;
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
      const id = placeNewElement(doc, slideId, slide, args.element!, blocks);
      return { slideId, created: { elementId: id } };
    }
    case "update_element": {
      const el = liveElement(slide, args.elementId!, true);
      if (isRemovedSlot(el)) reviveSlot(el);
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
      snapBack(doc, slideId, idsOf(slide, args, 1, true));
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
