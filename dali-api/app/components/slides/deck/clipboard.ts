import type { ImportBlock, ImportInline, ImportTable } from "~/components/slides/pptx/import-types";
import { cleanChart, cleanIcon, cleanPoll, cleanVideoUrl, type ChartSpec, type PollSpec } from "./content";
import { placementOf, expandToLeaves, type Placed } from "./freeform";
import { cleanCrop, type Crop } from "./crop";
import { boundsOf, rotatedBounds } from "./geometry";
import { FILL_IDS, SHAPE_KINDS, type FillId, type ShapeKind } from "./model";
import type { RenderElement, RenderSlide } from "./snapshot";
import { STAGE_W } from "./layouts";
import { TEXT_STYLE_IDS, type TextStyleId } from "./themes";

export const CLIP_MARK = "dali-slides-elements";
export const CLIP_VERSION = 1;
export const MAX_CLIP_ITEMS = 100;
const MAX_BLOCKS = 200;
const MAX_DEPTH = 4;
const MAX_TEXT = 20_000;
const MAX_ALT = 500;

export type ClipKind = "text" | "image" | "shape" | "group" | "chart" | "icon" | "video" | "poll";

export interface ClipItem {
  key: string;
  kind: ClipKind;
  placed: Placed;
  shape?: ShapeKind;
  fill?: FillId;
  src?: string;
  alt?: string;
  crop?: Crop;
  textStyle?: TextStyleId;
  blocks?: ImportBlock[];
  children?: string[];
  chart?: ChartSpec;
  icon?: string;
  videoUrl?: string;
  poll?: PollSpec;
}

const MARKS = ["bold", "italic", "underline", "strike"] as const;

function inlinesOf(content: unknown): ImportInline[] {
  if (!Array.isArray(content)) return [];
  const out: ImportInline[] = [];
  for (const raw of content as Array<Record<string, unknown>>) {
    if (raw?.type === "link" && typeof raw.href === "string") {
      out.push({ type: "link", href: raw.href, content: inlinesOf(raw.content) });
    } else if (raw?.type === "text" && typeof raw.text === "string") {
      const styles = (raw.styles ?? {}) as Record<string, unknown>;
      out.push({ type: "text", text: raw.text, styles: Object.fromEntries(MARKS.filter((m) => styles[m] === true).map((m) => [m, true])) });
    }
  }
  return out;
}

export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLS = 20;
const LANGUAGE = /^[a-z0-9+#.-]{1,40}$/i;

function tableOf(content: unknown): ImportTable | null {
  if (!isObj(content) || !Array.isArray(content.rows)) return null;
  const rows = (content.rows as unknown[]).slice(0, MAX_TABLE_ROWS).map((row) => {
    const cells = isObj(row) && Array.isArray(row.cells) ? (row.cells as unknown[]) : [];
    return cells.slice(0, MAX_TABLE_COLS).map((cell) => inlinesOf(isObj(cell) ? cell.content : cell));
  });
  if (rows.length === 0 || rows.every((r) => r.length === 0)) return null;
  const width = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => [...r, ...Array.from({ length: width - r.length }, (): ImportInline[] => [])]);
  const header = typeof content.headerRows === "number" && content.headerRows > 0;
  return { header, rows: padded };
}

function importTableOf(raw: unknown): ImportTable | null {
  if (!isObj(raw) || !Array.isArray(raw.rows)) return null;
  const rows = (raw.rows as unknown[]).slice(0, MAX_TABLE_ROWS).map((row) => (Array.isArray(row) ? row : []).slice(0, MAX_TABLE_COLS).map((cell) => inlinesOf(cell)));
  return rows.length && rows.some((r) => r.length) ? { header: raw.header === true, rows } : null;
}

function blockOf(b: Record<string, unknown>): ImportBlock {
  const children = blocksOf(b.children);
  if (b.type === "table") {
    const table = isObj(b.table) ? importTableOf(b.table) : tableOf(b.content);
    if (table) return { type: "table", content: [], children, table };
  }
  if (b.type === "codeBlock") {
    const language = isObj(b.props) && typeof b.props.language === "string" && LANGUAGE.test(b.props.language) ? b.props.language : "text";
    return { type: "codeBlock", content: inlinesOf(b.content), children, language };
  }
  return {
    type: b.type === "bulletListItem" || b.type === "checkListItem" ? "bulletListItem" : b.type === "numberedListItem" ? "numberedListItem" : "paragraph",
    content: inlinesOf(b.content),
    children,
  };
}

function blocksOf(blocks: unknown): ImportBlock[] {
  if (!Array.isArray(blocks)) return [];
  return (blocks as Array<Record<string, unknown>>).map(blockOf);
}

/** Plain blocks for the clipboard from a text element's rich blocks. Formatting beyond bold, italic, underline, strike and links is dropped. */
export function importBlocksOf(blocks: unknown): ImportBlock[] {
  return blocksOf(blocks);
}

function groupBounds(slide: RenderSlide, el: RenderElement): Placed | null {
  const boxes = (el.children ?? [])
    .map((id) => slide.elements.find((e) => e.id === id))
    .flatMap((child) => {
      const p = child && placementOf(slide.layoutId, child);
      return p ? [rotatedBounds(p)] : [];
    });
  return boxes.length ? { ...boundsOf(boxes), rot: 0 } : null;
}

function itemOf(slide: RenderSlide, el: RenderElement): ClipItem | null {
  const placed = el.kind === "group" ? groupBounds(slide, el) : placementOf(slide.layoutId, el);
  if (!placed) return null;
  const base = { key: el.id, placed };
  if (el.kind === "group") return { ...base, kind: "group", children: el.children ?? [] };
  if (el.kind === "text") return { ...base, kind: "text", blocks: importBlocksOf(el.blocks), ...(el.textStyle ? { textStyle: el.textStyle } : {}) };
  if (el.kind === "image") return { ...base, kind: "image", src: el.src ?? "", alt: el.alt ?? "", ...(el.crop ? { crop: el.crop } : {}) };
  if (el.kind === "shape") return { ...base, kind: "shape", shape: el.shape ?? "rect", ...(el.fill ? { fill: el.fill } : {}) };
  if (el.kind === "chart" && el.chart) return { ...base, kind: "chart", chart: el.chart };
  if (el.kind === "icon" && el.icon) return { ...base, kind: "icon", icon: el.icon, ...(el.fill ? { fill: el.fill } : {}) };
  if (el.kind === "video" && el.videoUrl) return { ...base, kind: "video", videoUrl: el.videoUrl };
  if (el.kind === "poll" && el.poll) return { ...base, kind: "poll", poll: el.poll };
  return null;
}

/** The clipboard text for the selected elements, or null when nothing copyable is selected. */
export function serializeSelection(slide: RenderSlide, ids: string[]): string | null {
  const leaves = expandToLeaves(slide, ids);
  const wanted = new Set<string>(leaves);
  const groups = slide.elements.filter((e) => e.kind === "group" && ids.includes(e.id));
  for (const g of groups) wanted.add(g.id);
  const items: ClipItem[] = [];
  for (const el of slide.elements) {
    if (!wanted.has(el.id)) continue;
    const item = itemOf(slide, el);
    if (item) items.push(item);
  }
  if (items.length === 0) return null;
  return JSON.stringify({ mark: CLIP_MARK, v: CLIP_VERSION, items });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function safeImageUrl(src: unknown): string | null {
  if (typeof src !== "string" || src.length > 2048) return null;
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("/") && !src.startsWith("//")) return src;
  return null;
}

function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) || (href.startsWith("/") && !href.startsWith("//")) ? href : null;
}

function cleanInlines(content: unknown, budget: { chars: number }): ImportInline[] {
  const out: ImportInline[] = [];
  for (const inline of inlinesOf(content)) {
    if (inline.type === "link") {
      const href = safeHref(inline.href ?? "");
      const inner = cleanInlines(inline.content, budget);
      if (href) out.push({ type: "link", href, content: inner });
      else out.push(...inner);
    } else {
      const text = (inline.text ?? "").slice(0, Math.max(0, budget.chars));
      budget.chars -= text.length;
      if (text) out.push({ type: "text", text, styles: inline.styles ?? {} });
    }
  }
  return out;
}

function cleanBlocks(blocks: unknown, budget: { chars: number; blocks: number }, depth = 0): ImportBlock[] {
  if (depth >= MAX_DEPTH) return [];
  const out: ImportBlock[] = [];
  for (const block of blocksOf(blocks)) {
    if (budget.blocks <= 0) break;
    budget.blocks--;
    const table = block.table && { header: block.table.header, rows: block.table.rows.map((row) => row.map((cell) => cleanInlines(cell, budget))) };
    out.push({
      type: block.type,
      content: cleanInlines(block.content, budget),
      children: cleanBlocks(block.children, budget, depth + 1),
      ...(table ? { table } : {}),
      ...(block.language ? { language: block.language } : {}),
    });
  }
  return out;
}

function cleanPlaced(raw: unknown): Placed | null {
  if (!isObj(raw) || ![raw.x, raw.y, raw.w, raw.h].every(finite)) return null;
  const w = clamp(raw.w as number, 1, STAGE_W * 4);
  const h = clamp(raw.h as number, 1, STAGE_W * 4);
  return {
    x: clamp(raw.x as number, -STAGE_W * 2, STAGE_W * 3),
    y: clamp(raw.y as number, -STAGE_W * 2, STAGE_W * 3),
    w,
    h,
    rot: finite(raw.rot) ? clamp(raw.rot, -360, 360) : 0,
  };
}

/** Items from clipboard text, with every field checked, or null when the text is not ours. Nothing from the text is trusted as-is. */
export function parseClipboard(text: string): ClipItem[] | null {
  if (text.length > 5_000_000 || !text.startsWith("{")) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(data) || data.mark !== CLIP_MARK || data.v !== CLIP_VERSION || !Array.isArray(data.items)) return null;
  return cleanItems(data.items);
}

export function cleanBlocksFor(blocks: unknown): ImportBlock[] {
  return cleanBlocks(blocks, { chars: MAX_TEXT, blocks: MAX_BLOCKS });
}

/** Items from raw clipboard data with every field checked. Null when nothing survives. */
export function cleanItems(rawItems: unknown[]): ClipItem[] | null {
  const budget = { chars: MAX_TEXT, blocks: MAX_BLOCKS };
  const out: ClipItem[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems.slice(0, MAX_CLIP_ITEMS)) {
    if (!isObj(raw) || typeof raw.key !== "string" || seen.has(raw.key)) continue;
    const placed = cleanPlaced(raw.placed);
    if (!placed) continue;
    const base = { key: raw.key, placed };
    if (raw.kind === "text") {
      out.push({
        ...base,
        kind: "text",
        blocks: cleanBlocks(raw.blocks, budget),
        ...(TEXT_STYLE_IDS.includes(raw.textStyle as TextStyleId) ? { textStyle: raw.textStyle as TextStyleId } : {}),
      });
    } else if (raw.kind === "image") {
      const src = safeImageUrl(raw.src);
      if (!src) continue;
      const crop = cleanCrop(raw.crop);
      out.push({ ...base, kind: "image", src, alt: typeof raw.alt === "string" ? raw.alt.slice(0, MAX_ALT) : "", ...(crop ? { crop } : {}) });
    } else if (raw.kind === "shape") {
      out.push({
        ...base,
        kind: "shape",
        shape: SHAPE_KINDS.includes(raw.shape as ShapeKind) ? (raw.shape as ShapeKind) : "rect",
        ...(FILL_IDS.includes(raw.fill as FillId) ? { fill: raw.fill as FillId } : {}),
      });
    } else if (raw.kind === "chart") {
      const chart = cleanChart(raw.chart);
      if (!chart) continue;
      out.push({ ...base, kind: "chart", chart });
    } else if (raw.kind === "icon") {
      const icon = cleanIcon(raw.icon);
      if (!icon) continue;
      out.push({ ...base, kind: "icon", icon, ...(FILL_IDS.includes(raw.fill as FillId) ? { fill: raw.fill as FillId } : {}) });
    } else if (raw.kind === "video") {
      const videoUrl = cleanVideoUrl(raw.videoUrl);
      if (!videoUrl) continue;
      out.push({ ...base, kind: "video", videoUrl });
    } else if (raw.kind === "poll") {
      const poll = cleanPoll(raw.poll);
      if (!poll) continue;
      out.push({ ...base, kind: "poll", poll });
    } else if (raw.kind === "group") {
      out.push({ ...base, kind: "group", children: Array.isArray(raw.children) ? raw.children.filter((c): c is string => typeof c === "string") : [] });
    } else continue;
    seen.add(raw.key);
  }
  for (const item of out) if (item.kind === "group") item.children = (item.children ?? []).filter((c) => seen.has(c) && out.find((o) => o.key === c)?.kind !== "group");
  const kept = out.filter((i) => i.kind !== "group" || (i.children?.length ?? 0) >= 2);
  return kept.length ? kept : null;
}
