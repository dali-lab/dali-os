import PptxGenJS from "pptxgenjs";
import type { DeckRead, DeckReadElement } from "~/collab/read-deck.server";
import type { DocBlock, DocInline } from "~/collab/blocknote-server";
import { layoutById, STAGE_H, STAGE_W, type LayoutSlot } from "~/components/slides/deck/layouts";
import { TEXT_STYLE_IDS, themeById, type TextStyleDef, type TextStyleId, type ThemeDef } from "~/components/slides/deck/themes";
import { resolveThemeColor, resolveThemeFont } from "./theme-colors";
import { unitsToInches, unitsToPoints } from "./units";
import type { ImageSize } from "./image-size";

export interface ExportImage {
  data: string;
  size: ImageSize | null;
}

export interface BuildPptxOptions {
  title: string;
  loadImage: (src: string) => Promise<ExportImage | null>;
  origin?: string;
}

export interface BuiltPptx {
  buffer: Buffer;
  slideCount: number;
  skippedImages: number;
}

const MASTER = "DALI";
const HEADING_SCALE = 1.25;

interface RunOptions {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  hyperlink?: { url: string };
  breakLine?: boolean;
  bullet?: boolean | { type: "number" };
  indentLevel?: number;
  fontFace?: string;
  fontSize?: number;
}

export interface PptxRun {
  text: string;
  options: RunOptions;
}

interface RunContext {
  upper: boolean;
  origin?: string;
  boldAll: boolean;
}

function absoluteUrl(href: string, origin?: string): string | null {
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (href.startsWith("/") && origin) return `${origin}${href}`;
  return null;
}

function inlineRuns(content: DocInline[] | undefined, ctx: RunContext, link?: string): PptxRun[] {
  const runs: PptxRun[] = [];
  for (const inline of content ?? []) {
    if (inline.type === "link") {
      runs.push(...inlineRuns(inline.content, ctx, absoluteUrl(inline.href ?? "", ctx.origin) ?? undefined));
      continue;
    }
    let text = "";
    const styles = inline.styles ?? {};
    if (inline.type === "text") text = inline.text ?? "";
    else if (inline.type === "mention") text = `@${String(inline.props?.label ?? "")}`;
    else continue;
    if (!text) continue;
    runs.push({
      text: ctx.upper ? text.toUpperCase() : text,
      options: {
        ...(ctx.boldAll || styles.bold === true ? { bold: true } : {}),
        ...(styles.italic === true ? { italic: true } : {}),
        ...(styles.underline === true ? { underline: true } : {}),
        ...(styles.strike === true ? { strike: true } : {}),
        ...(link ? { hyperlink: { url: link } } : {}),
      },
    });
  }
  return runs;
}

const LIST_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);

function blockRuns(blocks: DocBlock[], ctx: RunContext, level = 0): PptxRun[] {
  const out: PptxRun[] = [];
  for (const block of blocks) {
    const content = Array.isArray(block.content) ? block.content : undefined;
    const isList = LIST_TYPES.has(block.type);
    const blockCtx: RunContext = { ...ctx, boldAll: ctx.boldAll || block.type === "heading" };
    let runs = inlineRuns(content, blockCtx);
    if (block.type === "checkListItem") runs = [{ text: block.props.checked === true ? "☑ " : "☐ ", options: {} }, ...runs];
    if (block.type === "quote") runs = runs.map((r) => ({ ...r, options: { ...r.options, italic: true } }));
    if (block.type === "codeBlock") runs = runs.map((r) => ({ ...r, options: { ...r.options, fontFace: "Courier New" } }));
    if (runs.length === 0) runs = [{ text: "", options: {} }];
    runs[0].options = {
      ...runs[0].options,
      ...(block.type === "bulletListItem" || block.type === "checkListItem" ? { bullet: true } : {}),
      ...(block.type === "numberedListItem" ? { bullet: { type: "number" as const } } : {}),
      ...(isList && level > 0 ? { indentLevel: level } : {}),
      ...(block.type === "heading" ? { fontSize: -1 } : {}),
    };
    runs[runs.length - 1].options.breakLine = true;
    out.push(...runs);
    if (block.children?.length) out.push(...blockRuns(block.children, ctx, isList ? level + 1 : level));
  }
  return out;
}

/** The runs for a slot's blocks. A heading block carries `fontSize: -1`, resolved by the caller against the slot's size. */
export function blocksToRuns(blocks: DocBlock[], opts: { upper?: boolean; origin?: string } = {}): PptxRun[] {
  return blockRuns(blocks, { upper: opts.upper === true, origin: opts.origin, boldAll: false });
}

interface Place {
  rect: LayoutSlot["rect"];
  rot: number;
  align: "left" | "center";
  valign: "top" | "center" | "bottom";
  style: TextStyleId;
}

function styleFor(el: DeckReadElement, place: Place, theme: ThemeDef): TextStyleDef {
  const id = TEXT_STYLE_IDS.includes(el.textStyle as TextStyleId) ? (el.textStyle as TextStyleId) : place.style;
  return theme.textStyles[id];
}

function ownRect(el: DeckReadElement): LayoutSlot["rect"] | null {
  return el.x !== undefined && el.y !== undefined && el.w !== undefined && el.h !== undefined ? { x: el.x, y: el.y, w: el.w, h: el.h } : null;
}

const rotation = (rot: number) => (rot ? { rotate: ((rot % 360) + 360) % 360 } : {});

function colorOf(theme: ThemeDef, key: TextStyleDef["color"]): string {
  return resolveThemeColor(theme.colors[key]) ?? "FFFFFF";
}

function addText(pptxSlide: PptxGenJS.Slide, el: DeckReadElement, place: Place, theme: ThemeDef, origin?: string): void {
  const def = styleFor(el, place, theme);
  const size = unitsToPoints(def.size);
  const runs = blocksToRuns(el.blocks, { upper: def.uppercase, origin }).map((r) => {
    const { fontSize, ...rest } = r.options;
    return {
      text: r.text,
      options: { ...rest, ...(fontSize === -1 ? { fontSize: Math.round(size * HEADING_SCALE * 10) / 10 } : {}) },
    };
  });
  if (runs.every((r) => r.text === "")) return;
  const rect = place.rect;
  pptxSlide.addText(runs as PptxGenJS.TextProps[], {
    x: unitsToInches(rect.x),
    y: unitsToInches(rect.y),
    w: unitsToInches(rect.w),
    h: unitsToInches(rect.h),
    margin: 0,
    fontFace: resolveThemeFont(def.font === "display" ? theme.fonts.display : theme.fonts.body),
    fontSize: Math.round(size * 10) / 10,
    bold: def.weight >= 600,
    color: colorOf(theme, def.color),
    align: place.align,
    valign: place.valign === "center" ? "middle" : place.valign,
    ...rotation(place.rot),
    lineSpacingMultiple: def.leading,
    fit: "none",
    wrap: true,
  });
}

function placeImage(rect: LayoutSlot["rect"], size: ImageSize | null) {
  const area = { x: unitsToInches(rect.x), y: unitsToInches(rect.y), w: unitsToInches(rect.w), h: unitsToInches(rect.h) };
  if (!size || size.width <= 0 || size.height <= 0) return area;
  const scale = Math.max(rect.w / size.width, rect.h / size.height);
  const w = unitsToInches(size.width * scale);
  const h = unitsToInches(size.height * scale);
  return {
    x: area.x,
    y: area.y,
    w,
    h,
    sizing: { type: "cover" as const, w: area.w, h: area.h },
  };
}

async function addImage(pptxSlide: PptxGenJS.Slide, el: DeckReadElement, place: Place, load: BuildPptxOptions["loadImage"]): Promise<boolean> {
  if (!el.src) return true;
  const image = await load(el.src);
  if (!image) return false;
  pptxSlide.addImage({ data: image.data, altText: el.alt ?? "", ...placeImage(place.rect, image.size), ...rotation(place.rot) });
  return true;
}

const SHAPE_TYPES = { rect: "rect", rounded: "roundRect", ellipse: "ellipse" } as const;

function addShape(pptx: PptxGenJS, pptxSlide: PptxGenJS.Slide, el: DeckReadElement, rect: LayoutSlot["rect"], theme: ThemeDef): void {
  const color = resolveThemeColor(theme.colors[el.fill ?? "accent"]) ?? "FFFFFF";
  const box = { x: unitsToInches(rect.x), y: unitsToInches(rect.y), w: unitsToInches(rect.w), h: unitsToInches(rect.h), ...rotation(el.rot ?? 0) };
  const kind = el.shape ?? "rect";
  if (kind === "line" || kind === "arrow") {
    const thickness = kind === "arrow" ? rect.h / 4 : rect.h;
    pptxSlide.addShape(pptx.ShapeType.line, {
      ...box,
      y: unitsToInches(rect.y + rect.h / 2),
      h: 0,
      line: { color, width: Math.max(0.25, unitsToPoints(thickness)), ...(kind === "arrow" ? { endArrowType: "triangle" as const } : {}) },
    });
    return;
  }
  pptxSlide.addShape(pptx.ShapeType[SHAPE_TYPES[kind]], { ...box, fill: { color }, line: { type: "none" } });
}

export async function buildDeckPptx(deck: DeckRead, opts: BuildPptxOptions): Promise<BuiltPptx> {
  const theme = themeById(deck.themeId);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "DALI_16x9", width: unitsToInches(STAGE_W), height: unitsToInches(STAGE_H) });
  pptx.layout = "DALI_16x9";
  pptx.title = opts.title;
  pptx.company = "DALI Lab";
  pptx.theme = {
    headFontFace: resolveThemeFont(theme.fonts.display),
    bodyFontFace: resolveThemeFont(theme.fonts.body),
  };
  pptx.defineSlideMaster({
    title: MASTER,
    background: { color: resolveThemeColor(theme.colors.ground) ?? "000000" },
  });

  let skippedImages = 0;
  const slides = deck.slides;
  for (const slide of slides) {
    const pptxSlide = pptx.addSlide({ masterName: MASTER });
    const layout = layoutById(slide.layoutId);
    for (const el of slide.elements) {
      if (el.kind === "group") continue;
      const slot = layout.slots.find((s) => s.slot === el.slot);
      const own = ownRect(el);
      const rect = own ?? slot?.rect;
      if (!rect) continue;
      const place: Place = { rect, rot: el.rot ?? 0, align: slot?.align ?? "left", valign: slot?.valign ?? "top", style: slot?.style ?? "body" };
      if (el.kind === "text" && (!slot || slot.kind === "text")) addText(pptxSlide, el, place, theme, opts.origin);
      else if (el.kind === "image" && (!slot || slot.kind === "image")) {
        if (!(await addImage(pptxSlide, el, place, opts.loadImage))) skippedImages++;
      } else if (el.kind === "shape" && !slot && own) addShape(pptx, pptxSlide, el, own, theme);
    }
    if (slide.notes.text) pptxSlide.addNotes(slide.notes.text);
  }

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return { buffer: Buffer.from(out), slideCount: slides.length, skippedImages };
}
