import type { BaseElement, Element, Image, Shape, Slide, Text } from "pptxtojson";
import { STAGE_W } from "~/components/slides/deck/layouts";
import type { FillId, ShapeKind } from "~/components/slides/deck/model";
import { TEXT_STYLE_IDS, type TextStyleId } from "~/components/slides/deck/themes";
import { blocksText, parseTextHtml } from "./import-html";
import type { ImportBlock, ImportFree, ImportPlacement, ImportPlan, ImportSlide, ImportSlot, SkippedKind } from "./import-types";

export interface ParsedPresentation {
  slides: Slide[];
  size: { width: number; height: number };
}

interface TextCandidate {
  element: Text | Shape;
  blocks: ImportBlock[];
  maxFontPt: number;
  role: "title" | "subtitle" | "body" | null;
  /** Given the body role only because nothing else claimed it, so it has no placeholder to fill. */
  fallback: boolean;
}

const FULL_BLEED = 0.7;
const TITLE_BAND = 0.35;
const BIG_NUMBER = /^[\s$€£+-]*[\d][\d.,]*\s*(%|x|×|k|m|b|bn|\+)?\s*$/i;

function flatten(elements: Element[]): BaseElement[] {
  return elements.flatMap((el) => (el.type === "group" ? flatten(el.elements) : [el]));
}

function roleFromName(name: string | undefined): TextCandidate["role"] {
  const n = (name ?? "").toLowerCase();
  if (/sub\s*-?\s*title/.test(n)) return "subtitle";
  if (/title/.test(n)) return "title";
  if (/(content|body|text placeholder|object placeholder)/.test(n)) return "body";
  return null;
}

function readingOrder(a: TextCandidate, b: TextCandidate): number {
  return a.element.top - b.element.top || a.element.left - b.element.left;
}

function assignRoles(texts: TextCandidate[], slideHeight: number): void {
  for (const t of texts) t.role = roleFromName(t.element.name);
  const taken = (role: NonNullable<TextCandidate["role"]>) => texts.some((t) => t.role === role);
  if (!taken("title")) {
    const band = texts
      .filter((t) => t.role === null && t.element.top < slideHeight * TITLE_BAND)
      .sort((a, b) => b.maxFontPt - a.maxFontPt || a.element.top - b.element.top);
    if (band[0]) band[0].role = "title";
  }
  if (taken("title") && !taken("subtitle") && !taken("body")) {
    const title = texts.find((t) => t.role === "title")!;
    const below = texts
      .filter((t) => t.role === null && t.element.top >= title.element.top)
      .sort(readingOrder);
    if (below.length === 1) below[0].role = "subtitle";
  }
  for (const t of texts) {
    if (t.role === null) {
      t.role = "body";
      t.fallback = true;
    }
  }
}

function merge(texts: TextCandidate[], role: NonNullable<TextCandidate["role"]>): ImportBlock[] {
  return texts
    .filter((t) => t.role === role)
    .sort(readingOrder)
    .flatMap((t) => t.blocks);
}

function layoutFor(opts: {
  index: number;
  hasTitle: boolean;
  hasSubtitle: boolean;
  hasBody: boolean;
  image: Image | null;
  fullBleed: boolean;
  titleText: string;
}): string {
  const { index, hasTitle, hasSubtitle, hasBody, image, fullBleed, titleText } = opts;
  if (image) return fullBleed && !hasBody ? "image" : "split";
  if (hasBody) return "content";
  if (hasTitle && hasSubtitle && BIG_NUMBER.test(titleText)) return "bignumber";
  if (index === 0 || (hasTitle && hasSubtitle)) return "title";
  if (hasTitle) return "section";
  return "content";
}

function countSkipped(skipped: ImportPlan["skipped"], kind: SkippedKind): void {
  skipped[kind] = (skipped[kind] ?? 0) + 1;
}

function imageSource(el: Image): string | null {
  return typeof el.base64 === "string" && el.base64.startsWith("data:") ? el.base64 : null;
}

const SHAPE_BY_GEOM: Record<string, ShapeKind> = {
  rect: "rect",
  roundRect: "rounded",
  round1Rect: "rounded",
  round2SameRect: "rounded",
  ellipse: "ellipse",
  line: "line",
  straightConnector1: "line",
  rightArrow: "arrow",
};

function shapeKindOf(el: Shape): ShapeKind | null {
  const geom = el.shapType;
  if (!geom) return null;
  const known = SHAPE_BY_GEOM[geom];
  if (!known) return null;
  const arrowEnd = [el.headEnd, el.tailEnd].some((e) => e && e.type !== "none");
  return known === "line" && arrowEnd ? "arrow" : known;
}

function fillFromHex(hex: string | undefined, fallback: FillId): FillId {
  const m = /^#?([0-9a-f]{6})/i.exec(hex ?? "");
  if (!m) return fallback;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min > 0.25 ? "accent" : "muted";
}

function styleForSize(units: number): TextStyleId {
  const sizes: Record<TextStyleId, number> = { title: 120, heading: 72, body: 40, kicker: 28 };
  return TEXT_STYLE_IDS.reduce((best, id) => (Math.abs(Math.log(units / sizes[id])) < Math.abs(Math.log(units / sizes[best])) ? id : best), "body" as TextStyleId);
}

interface Scale {
  k: number;
}

function placementOf(el: BaseElement, scale: Scale, z: number): ImportPlacement {
  return {
    x: Math.round(el.left * scale.k),
    y: Math.round(el.top * scale.k),
    w: Math.max(1, Math.round(el.width * scale.k)),
    h: Math.max(1, Math.round(el.height * scale.k)),
    rot: Math.round(((el as { rotate?: number }).rotate ?? 0) % 360),
    z,
  };
}

function linePlacement(el: Shape, kind: ShapeKind, scale: Scale, z: number): ImportPlacement {
  const vertical = el.width * scale.k < 2 && el.height > 0;
  const length = Math.max(1, Math.round((vertical ? el.height : el.width) * scale.k));
  const stroke = Math.max(4, Math.round((el.borderWidth || 2) * scale.k));
  const thickness = kind === "arrow" ? Math.min(96, Math.max(32, stroke * 7)) : stroke;
  const cx = (el.left + el.width / 2) * scale.k;
  const cy = (el.top + el.height / 2) * scale.k;
  return { x: Math.round(cx - length / 2), y: Math.round(cy - thickness / 2), w: length, h: thickness, rot: vertical ? 90 : Math.round((el.rotate ?? 0) % 360), z };
}

function mapSlide(slide: Slide, index: number, size: { width: number; height: number }, skipped: ImportPlan["skipped"]): ImportSlide {
  const elements = flatten(slide.elements ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const scale: Scale = { k: STAGE_W / size.width };
  const texts: TextCandidate[] = [];
  const images: Image[] = [];
  const decor: Array<{ el: Shape; kind: ShapeKind }> = [];

  for (const el of elements) {
    switch (el.type) {
      case "text":
      case "shape": {
        const parsed = parseTextHtml(el.content ?? "");
        if (parsed.blocks.length > 0) texts.push({ element: el, blocks: parsed.blocks, maxFontPt: parsed.maxFontPt, role: null, fallback: false });
        else if (el.type === "shape" && el.shapType) {
          const kind = shapeKindOf(el);
          if (kind) decor.push({ el, kind });
          else countSkipped(skipped, "shape");
        }
        break;
      }
      case "image":
        if (imageSource(el)) images.push(el);
        else countSkipped(skipped, "image");
        break;
      case "table":
      case "chart":
      case "diagram":
      case "video":
      case "audio":
        countSkipped(skipped, el.type);
        break;
      case "math":
        countSkipped(skipped, "math");
        break;
    }
  }

  assignRoles(texts, size.height);
  const slotTexts = texts.filter((t) => !t.fallback);
  const freeTexts = texts.filter((t) => t.fallback);
  const title = merge(slotTexts, "title");
  const subtitle = merge(slotTexts, "subtitle");
  const body = merge(slotTexts, "body");

  const area = (el: Image) => el.width * el.height;
  const [hero, ...extra] = [...images].sort((a, b) => area(b) - area(a));
  const fullBleed = hero ? area(hero) >= size.width * size.height * FULL_BLEED : false;

  const free = freeTexts.length + extra.length + decor.length > 0;
  const layoutId =
    free && !hero && title.length === 0 && subtitle.length === 0 && body.length === 0
      ? "blank"
      : layoutFor({
          index,
          hasTitle: title.length > 0,
          hasSubtitle: subtitle.length > 0,
          hasBody: body.length > 0,
          image: hero ?? null,
          fullBleed,
          titleText: blocksText(title),
        });

  const hasSubtitleSlot = layoutId === "title" || layoutId === "section" || layoutId === "bignumber";
  const caption = layoutId === "image" && title.length === 0 ? subtitle : title;
  const out: ImportSlide = {
    layoutId,
    title: caption,
    subtitle: hasSubtitleSlot ? subtitle : [],
    body: layoutId === "content" || layoutId === "split" ? [...subtitle, ...body] : body,
    image: hero ? { dataUrl: imageSource(hero)!, alt: "", name: `slide-${index + 1}-image` } : null,
    notes: (slide.note ?? "").trim(),
  };
  if (!free) return out;

  const zOf = new Map<BaseElement, number>(elements.map((el, i) => [el, i + 1]));
  const z = (el: BaseElement) => zOf.get(el) ?? 1;
  const placements: ImportSlide["placements"] = {};
  const place = (slot: ImportSlot, list: BaseElement[]) => {
    if (list.length === 0) return;
    const left = Math.min(...list.map((e) => e.left));
    const top = Math.min(...list.map((e) => e.top));
    const right = Math.max(...list.map((e) => e.left + e.width));
    const bottom = Math.max(...list.map((e) => e.top + e.height));
    const box = { ...list[0], left, top, width: right - left, height: bottom - top, rotate: list.length === 1 ? (list[0] as { rotate?: number }).rotate ?? 0 : 0 };
    placements[slot] = placementOf(box as BaseElement, scale, Math.min(...list.map(z)));
  };
  const withRole = (...roles: Array<TextCandidate["role"]>) => slotTexts.filter((t) => roles.includes(t.role)).map((t) => t.element);
  const foldsSubtitle = layoutId === "content" || layoutId === "split";
  place("title", withRole(layoutId === "image" && title.length === 0 ? "subtitle" : "title"));
  place("subtitle", hasSubtitleSlot ? withRole("subtitle") : []);
  place("body", foldsSubtitle ? withRole("subtitle", "body") : withRole("body"));
  place("image", hero ? [hero] : []);

  const items: ImportFree[] = [
    ...freeTexts.map((t): ImportFree => ({
      kind: "text",
      placed: placementOf(t.element, scale, z(t.element)),
      blocks: t.blocks,
      textStyle: styleForSize(t.maxFontPt * scale.k),
    })),
    ...extra.map((el, i): ImportFree => ({ kind: "image", placed: placementOf(el, scale, z(el)), dataUrl: imageSource(el)!, alt: "", name: `slide-${index + 1}-extra-${i + 1}` })),
    ...decor.map(({ el, kind }): ImportFree => {
      const line = kind === "line" || kind === "arrow";
      return {
        kind: "shape",
        shape: kind,
        fill: line ? fillFromHex(el.borderColor, "fg") : fillFromHex(el.fill?.type === "color" ? el.fill.value : undefined, "surface"),
        placed: line ? linePlacement(el, kind, scale, z(el)) : placementOf(el, scale, z(el)),
      };
    }),
  ];
  return { ...out, free: items, placements };
}

/** Maps what pptxtojson read to deck slides: closest layout, text split into slots, one image per slide, and a count of what had no place. */
export function mapPresentation(parsed: ParsedPresentation): ImportPlan {
  const skipped: ImportPlan["skipped"] = {};
  const slides = parsed.slides.map((slide, i) => mapSlide(slide, i, parsed.size, skipped));
  return { slides, skipped };
}
