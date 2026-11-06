import * as Y from "yjs";
import type { RichDoc } from "~/components/slides/types";
import { fragmentToRichDoc } from "./fragment-blocks";
import {
  comparePos,
  compareZ,
  FILL_IDS,
  SHAPE_KINDS,
  type FillId,
  type ShapeKind,
  deckMap,
  elementsOf,
  isDeleted,
  restoreEpochOf,
  slidesMap,
  textOf,
  type SlideMap,
} from "./model";
import { cleanBuildFields, type BuildEffect } from "./builds";
import { slideMetaFields, type SlideBackground, type SlideTransition } from "./slide-meta";
import { contentFields, type ChartSpec, type PollSpec } from "./content";
import { cleanCrop, type Crop } from "./crop";
import { STAGE_H, STAGE_W } from "./layouts";
import { TEXT_STYLE_IDS, type TextStyleId } from "./themes";

export interface RenderElement {
  id: string;
  kind: string;
  slot: string | null;
  z: number;
  blocks: RichDoc;
  src: string | null;
  alt: string | null;
  textStyle: TextStyleId | null;
  /** The step this element appears at. Absent means it is there from the start. */
  build?: number;
  /** A text slot whose top-level blocks appear one per step after its own step. */
  buildBullets?: boolean;
  /** How the element enters while presenting. Absent means fade. */
  buildEffect?: BuildEffect;
  /** The step starts by itself after the previous one instead of waiting for a key press. */
  buildAfter?: boolean;
  /** Milliseconds to wait before an automatic step, 0 to 5000. */
  buildDelay?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rot?: number;
  shape?: ShapeKind;
  fill?: FillId;
  children?: string[];
  parentId?: string;
  chart?: ChartSpec;
  icon?: string;
  videoUrl?: string;
  poll?: PollSpec;
  html?: string;
  htmlFill?: true;
  crop?: Crop;
  locked?: boolean;
  hFixed?: boolean;
}

export interface RenderSlide {
  id: string;
  pos: number;
  layoutId: string;
  skipped?: boolean;
  background?: SlideBackground;
  transition?: SlideTransition;
  section?: string;
  elements: RenderElement[];
}

export interface DeckSnapshot {
  v: unknown;
  themeId: string;
  epoch: number;
  slides: RenderSlide[];
  deletedIds: string[];
  /** Who tombstoned each deleted slide, when they said. */
  deletedBy: Record<string, string | null>;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function geometryFields(read: (key: string) => unknown) {
  const x = num(read("x"));
  const y = num(read("y"));
  const w = num(read("w"));
  const h = num(read("h"));
  if (x === undefined || y === undefined || w === undefined || h === undefined || w <= 0 || h <= 0) return {};
  const rot = num(read("rot"));
  return { x, y, w, h, ...(rot ? { rot } : {}) };
}

export function shapeFields(read: (key: string) => unknown) {
  const shape = read("shape");
  const fill = read("fill");
  const children = read("children");
  return {
    ...(SHAPE_KINDS.includes(shape as ShapeKind) ? { shape: shape as ShapeKind } : {}),
    ...(FILL_IDS.includes(fill as FillId) ? { fill: fill as FillId } : {}),
    ...(Array.isArray(children) ? { children: children.filter((c): c is string => typeof c === "string") } : {}),
  };
}

export function extraFields(read: (key: string) => unknown) {
  const crop = cleanCrop(read("crop"));
  return {
    ...(crop ? { crop } : {}),
    ...(read("locked") === true ? { locked: true as const } : {}),
    ...(read("hFixed") === true ? { hFixed: true as const } : {}),
  };
}

const FILL_RECT = { x: 0, y: 0, w: STAGE_W, h: STAGE_H } as const;

/** A fill-slide HTML element covers the whole stage and cannot be moved, whatever geometry it holds. */
export function withFill<T extends { kind: string; htmlFill?: true; rot?: number }>(el: T): T {
  if (el.kind !== "html" || !el.htmlFill) return el;
  const { rot: _rot, ...rest } = el;
  return { ...rest, ...FILL_RECT, locked: true } as unknown as T;
}

export function snapshotSlide(id: string, slide: SlideMap, withText = true): RenderSlide {
  const fragments = textOf(slide);
  const elements: RenderElement[] = [];
  elementsOf(slide).forEach((el, elId) => {
    if (isDeleted(el)) return;
    const style = el.get("textStyle");
    elements.push(withFill({
      id: elId,
      kind: String(el.get("kind")),
      slot: str(el.get("slot")),
      z: Number(el.get("z") ?? 0),
      blocks: withText ? fragmentToRichDoc(fragments.get(elId)) : [],
      src: str(el.get("src")),
      alt: str(el.get("alt")),
      textStyle: TEXT_STYLE_IDS.includes(style as TextStyleId) ? (style as TextStyleId) : null,
      ...cleanBuildFields((k) => el.get(k)),
      ...geometryFields((k) => el.get(k)),
      ...shapeFields((k) => el.get(k)),
      ...contentFields((k) => el.get(k)),
      ...extraFields((k) => el.get(k)),
    }));
  });
  elements.sort(compareZ);
  linkGroups(elements);
  return {
    id,
    pos: Number(slide.get("pos") ?? 0),
    layoutId: String(slide.get("layoutId") ?? "content"),
    ...(slide.get("skipped") === true ? { skipped: true as const } : {}),
    ...slideMetaFields((k) => slide.get(k)),
    elements,
  };
}

export function linkGroups(elements: RenderElement[]): void {
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const group of elements) {
    if (group.kind !== "group") continue;
    for (const childId of group.children ?? []) {
      const child = byId.get(childId);
      if (child && child.kind !== "group" && !child.parentId) child.parentId = group.id;
    }
  }
}

export function snapshotDeck(doc: Y.Doc): DeckSnapshot {
  const slides: RenderSlide[] = [];
  const deletedIds: string[] = [];
  const deletedBy: Record<string, string | null> = {};
  slidesMap(doc).forEach((slide, id) => {
    if (isDeleted(slide)) {
      deletedIds.push(id);
      deletedBy[id] = str(slide.get("deletedBy"));
    } else slides.push(snapshotSlide(id, slide));
  });
  slides.sort(comparePos);
  return { ...deckFields(doc), slides, deletedIds, deletedBy };
}

export function deckFields(doc: Y.Doc): Pick<DeckSnapshot, "v" | "themeId" | "epoch"> {
  const themeId = deckMap(doc).get("themeId");
  return { v: deckMap(doc).get("v"), themeId: typeof themeId === "string" ? themeId : "dali-dark", epoch: restoreEpochOf(doc) };
}
