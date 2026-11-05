import type { BaseElement, Element, Image, Shape, Slide, Text } from "pptxtojson";
import { blocksText, parseTextHtml } from "./import-html";
import type { ImportBlock, ImportPlan, ImportSlide, SkippedKind } from "./import-types";

export interface ParsedPresentation {
  slides: Slide[];
  size: { width: number; height: number };
}

interface TextCandidate {
  element: Text | Shape;
  blocks: ImportBlock[];
  maxFontPt: number;
  role: "title" | "subtitle" | "body" | null;
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
  for (const t of texts) if (t.role === null) t.role = "body";
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

function mapSlide(slide: Slide, index: number, size: { width: number; height: number }, skipped: ImportPlan["skipped"]): ImportSlide {
  const elements = flatten(slide.elements ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const texts: TextCandidate[] = [];
  const images: Image[] = [];

  for (const el of elements) {
    switch (el.type) {
      case "text":
      case "shape": {
        const parsed = parseTextHtml(el.content ?? "");
        if (parsed.blocks.length > 0) texts.push({ element: el, blocks: parsed.blocks, maxFontPt: parsed.maxFontPt, role: null });
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
  const title = merge(texts, "title");
  const subtitle = merge(texts, "subtitle");
  const body = merge(texts, "body");

  const area = (el: Image) => el.width * el.height;
  const [hero, ...extra] = [...images].sort((a, b) => area(b) - area(a));
  for (let i = 0; i < extra.length; i++) countSkipped(skipped, "image");
  const fullBleed = hero ? area(hero) >= size.width * size.height * FULL_BLEED : false;

  const layoutId = layoutFor({
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
  return {
    layoutId,
    title: caption,
    subtitle: hasSubtitleSlot ? subtitle : [],
    body: layoutId === "content" || layoutId === "split" ? [...subtitle, ...body] : body,
    image: hero ? { dataUrl: imageSource(hero)!, alt: "", name: `slide-${index + 1}-image` } : null,
    notes: (slide.note ?? "").trim(),
  };
}

/** Maps what pptxtojson read to deck slides: closest layout, text split into slots, one image per slide, and a count of what had no place. */
export function mapPresentation(parsed: ParsedPresentation): ImportPlan {
  const skipped: ImportPlan["skipped"] = {};
  const slides = parsed.slides.map((slide, i) => mapSlide(slide, i, parsed.size, skipped));
  return { slides, skipped };
}
