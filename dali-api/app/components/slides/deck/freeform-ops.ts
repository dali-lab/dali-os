import * as Y from "yjs";
import { writeBlocks } from "~/components/slides/pptx/fragment-write";
import type { ClipItem } from "./clipboard";
import { cleanChart, cleanIcon, cleanVideoUrl, DEFAULT_CHART_DATA, type ChartSpec, type ChartType } from "./content";
import type { ImportBlock } from "~/components/slides/pptx/import-types";
import { cleanCrop, type Crop } from "./crop";
import type { StyleClip } from "./style-clip";
import { cloneValue, DECK_CREATE, DECK_LOCAL, insertTracked, newId } from "./deck-ops";
import { expandToLeaves, FREE_DEFAULTS, MIN_SIZE, LINE_MIN_SIZE, placementOf, type Placed } from "./freeform";
import { alignDeltas, boundsOf, distributeDeltas, rotatedBounds, SLIDE_RECT, type AlignMode, type Axis, type Rect } from "./geometry";
import { STAGE_H, STAGE_W } from "./layouts";
import {
  compareZ,
  elementsOf,
  isDeleted,
  newElementMap,
  slidesMap,
  textOf,
  tombstoneElement,
  type ElementMap,
  type FillId,
  type ShapeKind,
  type SlideMap,
} from "./model";
import { snapshotSlide, type RenderSlide } from "./snapshot";
import type { TextStyleId } from "./themes";

export type Point = { x: number; y: number };

const GEOMETRY_KEYS = ["x", "y", "w", "h", "rot"] as const;
const round = (n: number) => Math.round(n * 100) / 100;

function slideOf(doc: Y.Doc, slideId: string): SlideMap | null {
  const slide = slidesMap(doc).get(slideId);
  return slide && !isDeleted(slide) ? slide : null;
}

const view = (slideId: string, slide: SlideMap): RenderSlide => snapshotSlide(slideId, slide, false);

function topZ(slide: SlideMap): number {
  let z = 0;
  elementsOf(slide).forEach((el) => {
    if (!isDeleted(el)) z = Math.max(z, Number(el.get("z") ?? 0));
  });
  return z + 1;
}

function writePlacement(el: ElementMap, p: Placed): void {
  el.set("x", round(p.x));
  el.set("y", round(p.y));
  el.set("w", round(p.w));
  el.set("h", round(p.h));
  el.set("rot", round(p.rot));
}

function centeredAt(size: { w: number; h: number }, at: Point | undefined): Placed {
  const cx = at?.x ?? STAGE_W / 2;
  const cy = at?.y ?? STAGE_H / 2;
  const x = Math.min(Math.max(0, cx - size.w / 2), STAGE_W - size.w);
  const y = Math.min(Math.max(0, cy - size.h / 2), STAGE_H - size.h);
  return { x: Math.max(0, x), y: Math.max(0, y), w: size.w, h: size.h, rot: 0 };
}

export function addTextBox(doc: Y.Doc, slideId: string, at?: Point): string | null {
  const slide = slideOf(doc, slideId);
  if (!slide) return null;
  const id = newId();
  insertTracked(doc, (hide) => {
    const el = newElementMap(id, "text", topZ(slide));
    writePlacement(el, centeredAt(FREE_DEFAULTS.text, at));
    elementsOf(slide).set(id, el);
    textOf(slide).set(id, new Y.XmlFragment());
    hide(el);
  });
  return id;
}

export function addFreeImage(doc: Y.Doc, slideId: string, src: string, alt: string, natural?: { width: number; height: number } | null, at?: Point): string | null {
  const slide = slideOf(doc, slideId);
  if (!slide) return null;
  const id = newId();
  let size: { w: number; h: number } = FREE_DEFAULTS.image;
  if (natural && natural.width > 0 && natural.height > 0) {
    const scale = Math.min(1, FREE_DEFAULTS.image.w / natural.width, 640 / natural.height) || 1;
    size = { w: Math.max(MIN_SIZE, Math.round(natural.width * scale)), h: Math.max(MIN_SIZE, Math.round(natural.height * scale)) };
  }
  insertTracked(doc, (hide) => {
    const el = newElementMap(id, "image", topZ(slide), { src, alt });
    writePlacement(el, centeredAt(size, at));
    elementsOf(slide).set(id, el);
    hide(el);
  });
  return id;
}

export function addShape(doc: Y.Doc, slideId: string, shape: ShapeKind, at?: Point, fill: FillId = "accent"): string | null {
  const slide = slideOf(doc, slideId);
  if (!slide) return null;
  const id = newId();
  insertTracked(doc, (hide) => {
    const el = newElementMap(id, "shape", topZ(slide), { shape, fill });
    writePlacement(el, centeredAt(FREE_DEFAULTS[shape], at));
    elementsOf(slide).set(id, el);
    hide(el);
  });
  return id;
}

function addTextWith(doc: Y.Doc, slideId: string, size: { w: number; h: number }, blocks: ImportBlock[], at?: Point, style?: TextStyleId): string | null {
  const slide = slideOf(doc, slideId);
  if (!slide) return null;
  const id = newId();
  insertTracked(doc, (hide) => {
    const el = newElementMap(id, "text", topZ(slide), style ? { textStyle: style } : {});
    writePlacement(el, centeredAt(size, at));
    elementsOf(slide).set(id, el);
    const fragment = new Y.XmlFragment();
    textOf(slide).set(id, fragment);
    writeBlocks(fragment, blocks);
    hide(el);
  });
  return id;
}

export const TABLE_DEFAULT = { rows: 3, cols: 3 };

export function addTable(doc: Y.Doc, slideId: string, at?: Point, rows = TABLE_DEFAULT.rows, cols = TABLE_DEFAULT.cols): string | null {
  const r = Math.min(Math.max(1, Math.floor(rows)), 50);
  const c = Math.min(Math.max(1, Math.floor(cols)), 20);
  const table = { header: true, rows: Array.from({ length: r }, () => Array.from({ length: c }, () => [])) };
  const size = { w: FREE_DEFAULTS.table.w, h: Math.max(120, r * 100) };
  return addTextWith(doc, slideId, size, [{ type: "table", content: [], children: [], table }], at);
}

export function addCodeBlock(doc: Y.Doc, slideId: string, at?: Point): string | null {
  return addTextWith(doc, slideId, FREE_DEFAULTS.code, [{ type: "codeBlock", content: [], children: [], language: "text" }], at);
}

export function addEmoji(doc: Y.Doc, slideId: string, emoji: string, at?: Point): string | null {
  const glyph = emoji.trim();
  if (!glyph || glyph.length > 32) return null;
  return addTextWith(doc, slideId, FREE_DEFAULTS.emoji, [{ type: "paragraph", content: [{ type: "text", text: glyph, styles: {} }], children: [] }], at, "title");
}

function addContent(doc: Y.Doc, slideId: string, kind: "chart" | "icon" | "video", size: { w: number; h: number }, fields: Record<string, unknown>, at?: Point): string | null {
  const slide = slideOf(doc, slideId);
  if (!slide) return null;
  const id = newId();
  insertTracked(doc, (hide) => {
    const el = newElementMap(id, kind, topZ(slide), fields);
    writePlacement(el, centeredAt(size, at));
    elementsOf(slide).set(id, el);
    hide(el);
  });
  return id;
}

export function addChart(doc: Y.Doc, slideId: string, type: ChartType = "bar", at?: Point): string | null {
  return addContent(doc, slideId, "chart", FREE_DEFAULTS.chart, { chart: { type, data: DEFAULT_CHART_DATA } }, at);
}

export function addIcon(doc: Y.Doc, slideId: string, name: string, at?: Point, fill: FillId = "accent"): string | null {
  const icon = cleanIcon(name);
  return icon ? addContent(doc, slideId, "icon", FREE_DEFAULTS.icon, { icon, fill }, at) : null;
}

export function addVideo(doc: Y.Doc, slideId: string, url: string, at?: Point): string | null {
  const videoUrl = cleanVideoUrl(url);
  return videoUrl ? addContent(doc, slideId, "video", FREE_DEFAULTS.video, { videoUrl }, at) : null;
}

function setOnKind(doc: Y.Doc, slideId: string, id: string, kind: string, write: (el: ElementMap) => void): void {
  const slide = slideOf(doc, slideId);
  const el = slide && elementsOf(slide).get(id);
  if (!el || isDeleted(el) || el.get("kind") !== kind) return;
  doc.transact(() => write(el), DECK_LOCAL);
}

export function setChart(doc: Y.Doc, slideId: string, id: string, chart: ChartSpec): void {
  const clean = cleanChart(chart);
  if (clean) setOnKind(doc, slideId, id, "chart", (el) => el.set("chart", clean));
}

export function setIconName(doc: Y.Doc, slideId: string, id: string, name: string): void {
  const icon = cleanIcon(name);
  if (icon) setOnKind(doc, slideId, id, "icon", (el) => el.set("icon", icon));
}

export function setVideoUrl(doc: Y.Doc, slideId: string, id: string, url: string): boolean {
  const videoUrl = cleanVideoUrl(url);
  if (!videoUrl) return false;
  setOnKind(doc, slideId, id, "video", (el) => el.set("videoUrl", videoUrl));
  return true;
}

export type PlacedUpdate = Placed & { crop?: Crop | null };

const isLocked = (el: ElementMap) => el.get("locked") === true;

/**
 * Writes geometry for elements. A slot element that gets geometry is detached from its slot's place.
 * Locked elements are skipped, and a free text box whose height is set by hand stops growing with its text.
 */
export function setPlacements(doc: Y.Doc, slideId: string, updates: Record<string, PlacedUpdate>): void {
  const slide = slideOf(doc, slideId);
  if (!slide) return;
  doc.transact(() => {
    for (const [id, placed] of Object.entries(updates)) {
      const el = elementsOf(slide).get(id);
      if (!el || isDeleted(el) || isLocked(el)) continue;
      const before = el.get("h");
      writePlacement(el, placed);
      if (el.get("kind") === "text" && typeof before === "number" && Math.abs(before - placed.h) > 0.5 && el.get("hFixed") !== true) el.set("hFixed", true);
      if ("crop" in placed) {
        const crop = cleanCrop(placed.crop);
        if (crop) el.set("crop", { l: round(crop.l * 1e4) / 1e4, t: round(crop.t * 1e4) / 1e4, r: round(crop.r * 1e4) / 1e4, b: round(crop.b * 1e4) / 1e4 });
        else el.delete("crop");
      }
    }
  }, DECK_LOCAL);
}

/** Grows a free text box to fit its text. Not an undo step, and never shrinks or touches a box whose height was set by hand. */
export function setAutoHeight(doc: Y.Doc, slideId: string, id: string, needed: number): boolean {
  const slide = slideOf(doc, slideId);
  const el = slide && elementsOf(slide).get(id);
  if (!el || isDeleted(el) || isLocked(el) || el.get("kind") !== "text" || typeof el.get("slot") === "string" || el.get("hFixed") === true) return false;
  const h = Number(el.get("h"));
  if (!Number.isFinite(h) || needed <= h + 1) return false;
  doc.transact(() => el.set("h", round(Math.min(needed, STAGE_H * 2))), DECK_CREATE);
  return true;
}

export function setLocked(doc: Y.Doc, slideId: string, ids: string[], locked: boolean): void {
  const slide = slideOf(doc, slideId);
  if (!slide) return;
  doc.transact(() => {
    for (const id of expandToLeaves(view(slideId, slide), ids)) {
      const el = elementsOf(slide).get(id);
      if (!el || isDeleted(el)) continue;
      if (locked) el.set("locked", true);
      else el.delete("locked");
    }
  }, DECK_LOCAL);
}

export function setCrop(doc: Y.Doc, slideId: string, id: string, crop: Crop | null): void {
  const slide = slideOf(doc, slideId);
  const el = slide && elementsOf(slide).get(id);
  if (!el || isDeleted(el) || el.get("kind") !== "image") return;
  const clean = cleanCrop(crop);
  doc.transact(() => (clean ? el.set("crop", clean) : el.delete("crop")), DECK_LOCAL);
}

export function applyStyle(doc: Y.Doc, slideId: string, ids: string[], clip: StyleClip): number {
  const slide = slideOf(doc, slideId);
  if (!slide) return 0;
  let applied = 0;
  doc.transact(() => {
    for (const id of expandToLeaves(view(slideId, slide), ids)) {
      const el = elementsOf(slide).get(id);
      if (!el || isDeleted(el) || isLocked(el) || el.get("kind") !== clip.kind) continue;
      if (clip.kind === "shape") {
        if (clip.fill) el.set("fill", clip.fill);
        const thin = (k: string) => k === "line" || k === "arrow";
        if (clip.shape && thin(clip.shape) === thin(String(el.get("shape")))) el.set("shape", clip.shape);
      } else if (clip.textStyle) el.set("textStyle", clip.textStyle);
      applied++;
    }
  }, DECK_LOCAL);
  return applied;
}

function currentPlacements(slideId: string, slide: SlideMap, ids: string[]): Map<string, Placed> {
  const snap = view(slideId, slide);
  const out = new Map<string, Placed>();
  for (const id of expandToLeaves(snap, ids)) {
    const el = snap.elements.find((e) => e.id === id);
    const placed = el && placementOf(snap.layoutId, el);
    if (placed) out.set(id, placed);
  }
  return out;
}

export function moveElements(doc: Y.Doc, slideId: string, ids: string[], dx: number, dy: number): void {
  const slide = slideOf(doc, slideId);
  if (!slide || (dx === 0 && dy === 0)) return;
  const updates: Record<string, Placed> = {};
  currentPlacements(slideId, slide, ids).forEach((p, id) => (updates[id] = { ...p, x: p.x + dx, y: p.y + dy }));
  setPlacements(doc, slideId, updates);
}

export function placementsOf(doc: Y.Doc, slideId: string, ids: string[]): Map<string, Placed> {
  const slide = slideOf(doc, slideId);
  return slide ? currentPlacements(slideId, slide, ids) : new Map();
}

export function alignElements(doc: Y.Doc, slideId: string, ids: string[], mode: AlignMode, to: "slide" | "selection"): void {
  const slide = slideOf(doc, slideId);
  if (!slide) return;
  const placements = currentPlacements(slideId, slide, ids);
  const entries = [...placements.entries()];
  if (entries.length === 0 || (to === "selection" && entries.length < 2)) return;
  const boxes = entries.map(([, p]) => rotatedBounds(p));
  const deltas = alignDeltas(boxes, to === "slide" ? SLIDE_RECT : boundsOf(boxes), mode);
  const updates: Record<string, Placed> = {};
  entries.forEach(([id, p], i) => (updates[id] = { ...p, x: p.x + deltas[i].dx, y: p.y + deltas[i].dy }));
  setPlacements(doc, slideId, updates);
}

export function distributeElements(doc: Y.Doc, slideId: string, ids: string[], axis: Axis): void {
  const slide = slideOf(doc, slideId);
  if (!slide) return;
  const entries = [...currentPlacements(slideId, slide, ids).entries()];
  if (entries.length < 3) return;
  const { deltas } = distributeDeltas(entries.map(([, p]) => rotatedBounds(p)), axis);
  const updates: Record<string, Placed> = {};
  entries.forEach(([id, p], i) => (updates[id] = { ...p, x: p.x + deltas[i].dx, y: p.y + deltas[i].dy }));
  setPlacements(doc, slideId, updates);
}

/** Puts slot elements back where their layout draws them. */
export function snapBack(doc: Y.Doc, slideId: string, ids: string[]): void {
  const slide = slideOf(doc, slideId);
  if (!slide) return;
  doc.transact(() => {
    for (const id of ids) {
      const el = elementsOf(slide).get(id);
      if (el && !isDeleted(el) && typeof el.get("slot") === "string") for (const key of GEOMETRY_KEYS) el.delete(key);
    }
  }, DECK_LOCAL);
}

export function groupElements(doc: Y.Doc, slideId: string, ids: string[]): string | null {
  const slide = slideOf(doc, slideId);
  if (!slide) return null;
  const snap = view(slideId, slide);
  const leaves = expandToLeaves(snap, ids);
  if (leaves.length < 2) return null;
  const id = newId();
  const oldGroups = new Set(leaves.map((l) => snap.elements.find((e) => e.id === l)?.parentId).filter((g): g is string => Boolean(g)));
  doc.transact(() => {
    for (const g of oldGroups) {
      const el = elementsOf(slide).get(g);
      if (el) tombstoneElement(el);
    }
    const z = Math.max(...leaves.map((l) => Number(elementsOf(slide).get(l)?.get("z") ?? 0)));
    elementsOf(slide).set(id, newElementMap(id, "group", z, { children: leaves }));
  }, DECK_LOCAL);
  return id;
}

/** Dissolves groups. Their children stay exactly where they are; the group itself is only tombstoned. */
export function ungroupElements(doc: Y.Doc, slideId: string, ids: string[]): string[] {
  const slide = slideOf(doc, slideId);
  if (!slide) return [];
  const snap = view(slideId, slide);
  const groups = snap.elements.filter((e) => e.kind === "group" && (ids.includes(e.id) || (e.children ?? []).some((c) => ids.includes(c))));
  doc.transact(() => {
    for (const g of groups) {
      const el = elementsOf(slide).get(g.id);
      if (el) tombstoneElement(el);
    }
  }, DECK_LOCAL);
  return groups.flatMap((g) => g.children ?? []);
}

/** Free elements and groups only: a slot belongs to its layout. Image slots lose their picture instead. */
export function deleteElements(doc: Y.Doc, slideId: string, ids: string[]): string[] {
  const slide = slideOf(doc, slideId);
  if (!slide) return [];
  const snap = view(slideId, slide);
  const removed: string[] = [];
  doc.transact(() => {
    const kill = (id: string) => {
      const el = elementsOf(slide).get(id);
      if (!el || isDeleted(el) || isLocked(el)) return;
      if (typeof el.get("slot") === "string") {
        if (el.get("kind") === "image") el.set("src", "");
        return;
      }
      tombstoneElement(el);
      removed.push(id);
    };
    for (const id of ids) {
      const e = snap.elements.find((x) => x.id === id);
      if (e?.kind === "group") (e.children ?? []).forEach(kill);
      kill(id);
    }
  }, DECK_LOCAL);
  return removed;
}

export type ReorderDirection = "forward" | "backward" | "front" | "back";

export function reorderElements(doc: Y.Doc, slideId: string, ids: string[], dir: ReorderDirection): void {
  const slide = slideOf(doc, slideId);
  if (!slide) return;
  const snap = view(slideId, slide);
  const chosen = new Set(expandToLeaves(snap, ids));
  const order = snap.elements.filter((e) => e.kind !== "group").sort(compareZ).map((e) => e.id);
  if (!order.some((id) => chosen.has(id))) return;
  const next = [...order];
  if (dir === "front") next.splice(0, next.length, ...order.filter((i) => !chosen.has(i)), ...order.filter((i) => chosen.has(i)));
  else if (dir === "back") next.splice(0, next.length, ...order.filter((i) => chosen.has(i)), ...order.filter((i) => !chosen.has(i)));
  else if (dir === "forward") {
    for (let i = next.length - 2; i >= 0; i--) if (chosen.has(next[i]) && !chosen.has(next[i + 1])) [next[i], next[i + 1]] = [next[i + 1], next[i]];
  } else {
    for (let i = 1; i < next.length; i++) if (chosen.has(next[i]) && !chosen.has(next[i - 1])) [next[i], next[i - 1]] = [next[i - 1], next[i]];
  }
  doc.transact(() => {
    next.forEach((id, i) => {
      const el = elementsOf(slide).get(id);
      if (el && el.get("z") !== i + 1) el.set("z", i + 1);
    });
  }, DECK_LOCAL);
}

export function setImageSource(doc: Y.Doc, slideId: string, id: string, src: string, alt: string): void {
  const slide = slideOf(doc, slideId);
  const el = slide && elementsOf(slide).get(id);
  if (!el || isDeleted(el) || el.get("kind") !== "image") return;
  doc.transact(() => {
    el.set("src", src);
    el.set("alt", alt);
  }, DECK_LOCAL);
}

export function setFill(doc: Y.Doc, slideId: string, ids: string[], fill: FillId): void {
  const slide = slideOf(doc, slideId);
  if (!slide) return;
  doc.transact(() => {
    for (const id of expandToLeaves(view(slideId, slide), ids)) {
      const el = elementsOf(slide).get(id);
      if (el && (el.get("kind") === "shape" || el.get("kind") === "icon")) el.set("fill", fill);
    }
  }, DECK_LOCAL);
}

export function setFreeTextStyle(doc: Y.Doc, slideId: string, id: string, style: TextStyleId | null): void {
  const slide = slideOf(doc, slideId);
  const el = slide && elementsOf(slide).get(id);
  if (el) doc.transact(() => el.set("textStyle", style), DECK_LOCAL);
}

export const DUPLICATE_OFFSET = 24;

/** Copies elements next to the originals. Copies of slot elements become free elements at the place the slot draws. Returns the new selection. */
export function duplicateElements(doc: Y.Doc, slideId: string, ids: string[], offset = DUPLICATE_OFFSET, mapping?: Map<string, string>): string[] {
  const slide = slideOf(doc, slideId);
  if (!slide) return [];
  const snap = view(slideId, slide);
  const leaves = expandToLeaves(snap, ids);
  if (leaves.length === 0) return [];
  const groupsInSelection = snap.elements.filter((e) => e.kind === "group" && (ids.includes(e.id) || (e.children ?? []).every((c) => leaves.includes(c)) && (e.children ?? []).some((c) => ids.includes(c))));
  const idMap = mapping ?? new Map<string, string>();
  for (const l of leaves) idMap.set(l, newId());
  const result: string[] = [];
  insertTracked(doc, (hide) => {
    let z = topZ(slide);
    const sorted = leaves.map((l) => snap.elements.find((e) => e.id === l)!).sort(compareZ);
    for (const source of sorted) {
      const from = elementsOf(slide).get(source.id)!;
      const placed = placementOf(snap.layoutId, source);
      const copy = new Y.Map<unknown>();
      from.forEach((value, key) => {
        if (key === "id" || key === "slot" || key === "z" || key === "deleted" || (GEOMETRY_KEYS as readonly string[]).includes(key)) return;
        copy.set(key, cloneValue(value));
      });
      const newKey = idMap.get(source.id)!;
      copy.set("id", newKey);
      copy.set("z", z++);
      copy.set("deleted", false);
      if (placed) writePlacement(copy, { ...placed, x: placed.x + offset, y: placed.y + offset });
      elementsOf(slide).set(newKey, copy);
      hide(copy);
      const fragment = textOf(slide).get(source.id);
      if (fragment) textOf(slide).set(newKey, cloneValue(fragment) as Y.XmlFragment);
      else if (source.kind === "text") textOf(slide).set(newKey, new Y.XmlFragment());
    }
    const groupedLeaves = new Set<string>();
    for (const g of groupsInSelection) {
      const children = (g.children ?? []).map((c) => idMap.get(c)).filter((c): c is string => Boolean(c));
      if (children.length < 2) continue;
      const gid = newId();
      const group = newElementMap(gid, "group", z++, { children });
      elementsOf(slide).set(gid, group);
      hide(group);
      children.forEach((c) => groupedLeaves.add(c));
      result.push(gid);
    }
    for (const l of leaves) {
      const copied = idMap.get(l)!;
      if (!groupedLeaves.has(copied)) result.push(copied);
    }
  });
  return result;
}

function pasteShift(items: ClipItem[], offset: number | { at: Point }): { dx: number; dy: number } {
  if (typeof offset === "number") return { dx: offset, dy: offset };
  const boxes = items.filter((i) => i.kind !== "group").map((i) => rotatedBounds(i.placed));
  if (boxes.length === 0) return { dx: 0, dy: 0 };
  const b = boundsOf(boxes);
  const dx = Math.min(Math.max(offset.at.x - b.w / 2, 0), Math.max(0, STAGE_W - b.w)) - b.x;
  const dy = Math.min(Math.max(offset.at.y - b.h / 2, 0), Math.max(0, STAGE_H - b.h)) - b.y;
  return { dx, dy };
}

export function writeClipItems(slide: SlideMap, items: ClipItem[], shift: { dx: number; dy: number }, hide: (map: Y.Map<unknown>) => void = () => {}): string[] {
  const idMap = new Map<string, string>(items.map((i) => [i.key, newId()]));
  const result: string[] = [];
  let z = topZ(slide);
  for (const item of items) {
    if (item.kind === "group") continue;
    const id = idMap.get(item.key)!;
    const fields: Record<string, unknown> = {};
    if (item.kind === "image") Object.assign(fields, { src: item.src ?? "", alt: item.alt ?? "", ...(item.crop ? { crop: item.crop } : {}) });
    if (item.kind === "shape") Object.assign(fields, { shape: item.shape ?? "rect", fill: item.fill ?? "accent" });
    if (item.kind === "text" && item.textStyle) fields.textStyle = item.textStyle;
    if (item.kind === "chart" && item.chart) fields.chart = item.chart;
    if (item.kind === "icon" && item.icon) Object.assign(fields, { icon: item.icon, fill: item.fill ?? "accent" });
    if (item.kind === "video" && item.videoUrl) fields.videoUrl = item.videoUrl;
    const el = newElementMap(id, item.kind, z++, fields);
    writePlacement(el, { ...item.placed, x: item.placed.x + shift.dx, y: item.placed.y + shift.dy });
    elementsOf(slide).set(id, el);
    hide(el);
    if (item.kind === "text") {
      const fragment = new Y.XmlFragment();
      textOf(slide).set(id, fragment);
      writeBlocks(fragment, item.blocks ?? []);
    }
  }
  const grouped = new Set<string>();
  for (const item of items) {
    if (item.kind !== "group") continue;
    const children = (item.children ?? []).map((c) => idMap.get(c)).filter((c): c is string => Boolean(c));
    if (children.length < 2) continue;
    const gid = newId();
    const group = newElementMap(gid, "group", z++, { children });
    elementsOf(slide).set(gid, group);
    hide(group);
    children.forEach((c) => grouped.add(c));
    result.push(gid);
  }
  for (const item of items) if (item.kind !== "group" && !grouped.has(idMap.get(item.key)!)) result.push(idMap.get(item.key)!);
  return result;
}

/** Writes sanitized clipboard items as new free elements. A number offsets them so a paste into the same spot is visible; `at` centres them on a point. Returns the new selection. */
export function pasteItems(doc: Y.Doc, slideId: string, items: ClipItem[], offset: number | { at: Point } = DUPLICATE_OFFSET): string[] {
  const slide = slideOf(doc, slideId);
  if (!slide || items.length === 0) return [];
  let result: string[] = [];
  insertTracked(doc, (hide) => {
    result = writeClipItems(slide, items, pasteShift(items, offset), hide);
  });
  return result;
}

export function minSizeFor(shape: string | null): { w: number; h: number } {
  return shape === "line" ? { w: MIN_SIZE, h: LINE_MIN_SIZE } : { w: MIN_SIZE, h: MIN_SIZE };
}

export type { Rect };
