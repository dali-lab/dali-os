import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PptxGenJS from "pptxgenjs";
import { chartColors } from "~/components/slides/deck/content";
import { ICONS } from "~/components/slides/deck/icon-set";
import { parseVideoEmbed } from "~/lib/video-embed";
import type { DeckRead, DeckReadElement } from "~/collab/read-deck.server";
import type { DocBlock, DocInline } from "~/collab/blocknote-server";
import { cropFrame, type Crop } from "~/components/slides/deck/crop";
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
  /** Draws an SVG as a PNG (`image/png;base64,...`). Without it, icons are left out of the file. */
  rasterize?: (svg: string, size: number) => Promise<string | null>;
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
    if (block.type === "table") continue;
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

export function placeImage(rect: LayoutSlot["rect"], size: ImageSize | null, crop?: Crop | null) {
  const area = { x: unitsToInches(rect.x), y: unitsToInches(rect.y), w: unitsToInches(rect.w), h: unitsToInches(rect.h) };
  if (crop) {
    const f = cropFrame(rect, crop);
    const known = size && size.width > 0 && size.height > 0 ? size : null;
    const scale = known ? Math.max(f.w / known.width, f.h / known.height) : 0;
    const w = known ? known.width * scale : f.w;
    const h = known ? known.height * scale : f.h;
    return {
      x: area.x,
      y: area.y,
      w: unitsToInches(w),
      h: unitsToInches(h),
      sizing: {
        type: "crop" as const,
        x: unitsToInches((w - f.w) / 2 - f.left),
        y: unitsToInches((h - f.h) / 2 - f.top),
        w: area.w,
        h: area.h,
      },
    };
  }
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
  pptxSlide.addImage({ data: image.data, altText: el.alt ?? "", ...placeImage(place.rect, image.size, el.crop), ...rotation(place.rot) });
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

interface TableData {
  header: number;
  rows: DocInline[][][];
}

function tableOf(block: DocBlock): TableData | null {
  const content = block.content as unknown as { headerRows?: number; rows?: Array<{ cells?: Array<DocInline[] | { content?: DocInline[] }> }> } | undefined;
  if (block.type !== "table" || !content || !Array.isArray(content.rows)) return null;
  const rows = content.rows.map((row) => (row.cells ?? []).map((cell) => (Array.isArray(cell) ? cell : (cell.content ?? []))));
  return rows.length ? { header: content.headerRows ?? 0, rows } : null;
}

function addTables(pptxSlide: PptxGenJS.Slide, el: DeckReadElement, rect: LayoutSlot["rect"], theme: ThemeDef, origin?: string): void {
  const tables = el.blocks.map(tableOf).filter((t): t is TableData => t !== null);
  const hasText = el.blocks.some((b) => b.type !== "table" && blockRuns([b], { upper: false, origin, boldAll: false }).some((r) => r.text !== ""));
  const top = hasText ? rect.h * 0.3 : 0;
  const per = (rect.h - top) / Math.max(1, tables.length);
  const border = { type: "solid" as const, pt: 1, color: resolveThemeColor(theme.colors.rule) ?? "888888" };
  const size = Math.round(unitsToPoints(theme.textStyles.body.size) * 10) / 10;
  tables.forEach((table, t) => {
    const cols = Math.max(...table.rows.map((r) => r.length));
    const rows = table.rows.map((cells, r) =>
      Array.from({ length: cols }, (_, c) => {
        const header = r < table.header;
        const runs = inlineRuns(cells[c], { upper: false, origin, boldAll: header });
        return {
          text: (runs.length ? runs : [{ text: "", options: {} }]) as PptxGenJS.TextProps[],
          options: { bold: header, ...(header ? { fill: { color: resolveThemeColor(theme.colors.surface) ?? "222222" } } : {}) },
        };
      }),
    );
    pptxSlide.addTable(rows as PptxGenJS.TableRow[], {
      x: unitsToInches(rect.x),
      y: unitsToInches(rect.y + top + t * per),
      w: unitsToInches(rect.w),
      colW: Array.from({ length: cols }, () => unitsToInches(rect.w) / cols),
      border,
      fontFace: resolveThemeFont(theme.fonts.body),
      fontSize: size,
      color: colorOf(theme, "fg"),
      valign: "top",
      margin: 0.08,
    });
  });
}

function addChartElement(pptx: PptxGenJS, pptxSlide: PptxGenJS.Slide, el: DeckReadElement, rect: LayoutSlot["rect"], theme: ThemeDef): boolean {
  const chart = el.chart;
  if (!chart) return false;
  const palette = chartColors(theme).map((c) => resolveThemeColor(c) ?? "888888");
  const { labels, series } = chart.data;
  const pie = chart.type === "pie";
  const data = (pie ? series.slice(0, 1) : series).map((s) => ({ name: s.name, labels, values: s.values }));
  const colors = pie ? labels.map((_, i) => palette[i % palette.length]) : data.map((_, i) => palette[i % palette.length]);
  const type = chart.type;
  const muted = colorOf(theme, "muted");
  pptxSlide.addChart(type, data, {
    x: unitsToInches(rect.x),
    y: unitsToInches(rect.y),
    w: unitsToInches(rect.w),
    h: unitsToInches(rect.h),
    chartColors: colors,
    showLegend: pie || data.length > 1,
    legendPos: pie ? "r" : "t",
    legendColor: muted,
    legendFontSize: 14,
    legendFontFace: resolveThemeFont(theme.fonts.body),
    catAxisLabelColor: muted,
    valAxisLabelColor: muted,
    catAxisLabelFontSize: 14,
    valAxisLabelFontSize: 14,
    valGridLine: { color: resolveThemeColor(theme.colors.rule) ?? "888888", size: 0.5 },
    catGridLine: { style: "none" },
    lineSize: 3,
    lineDataSymbolSize: 9,
    showPercent: pie,
    dataLabelColor: colorOf(theme, "fg"),
    dataLabelFontSize: 14,
  } as PptxGenJS.IChartOpts);
  return true;
}

async function addIconElement(pptxSlide: PptxGenJS.Slide, el: DeckReadElement, rect: LayoutSlot["rect"], theme: ThemeDef, rasterize: BuildPptxOptions["rasterize"]): Promise<boolean> {
  const Icon = el.icon ? ICONS[el.icon] : undefined;
  if (!Icon || !rasterize) return false;
  const color = resolveThemeColor(theme.colors[el.fill ?? "accent"]) ?? "FFFFFF";
  const svg = renderToStaticMarkup(createElement(Icon, { size: 256, color: `#${color}`, strokeWidth: 1.5 }));
  const data = await rasterize(svg, 256);
  if (!data) return false;
  const side = Math.min(rect.w, rect.h);
  pptxSlide.addImage({
    data,
    altText: el.icon ?? "",
    x: unitsToInches(rect.x + (rect.w - side) / 2),
    y: unitsToInches(rect.y + (rect.h - side) / 2),
    w: unitsToInches(side),
    h: unitsToInches(side),
    ...rotation(el.rot ?? 0),
  });
  return true;
}

function addVideoElement(pptx: PptxGenJS, pptxSlide: PptxGenJS.Slide, el: DeckReadElement, rect: LayoutSlot["rect"], theme: ThemeDef): void {
  const embed = el.videoUrl ? parseVideoEmbed(el.videoUrl) : null;
  if (!el.videoUrl || !embed) return;
  const box = { x: unitsToInches(rect.x), y: unitsToInches(rect.y), w: unitsToInches(rect.w), h: unitsToInches(rect.h), ...rotation(el.rot ?? 0) };
  const hyperlink = { url: el.videoUrl, tooltip: `Open the ${embed.provider} video` };
  pptxSlide.addShape(pptx.ShapeType.roundRect, { ...box, rectRadius: 0.2, fill: { color: resolveThemeColor(theme.colors.surface) ?? "222222" }, line: { type: "none" }, hyperlink } as PptxGenJS.ShapeProps);
  pptxSlide.addText([{ text: `\u25B6  ${embed.provider} video`, options: { hyperlink } }], {
    ...box,
    margin: 0,
    align: "center",
    valign: "middle",
    fontFace: resolveThemeFont(theme.fonts.body),
    fontSize: Math.round(unitsToPoints(theme.textStyles.body.size) * 10) / 10,
    color: colorOf(theme, "accent"),
    bold: true,
  });
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
    if (slide.skipped) pptxSlide.hidden = true;
    const layout = layoutById(slide.layoutId);
    for (const el of slide.elements) {
      if (el.kind === "group") continue;
      const slot = layout.slots.find((s) => s.slot === el.slot);
      const own = ownRect(el);
      const rect = own ?? slot?.rect;
      if (!rect) continue;
      const place: Place = { rect, rot: el.rot ?? 0, align: slot?.align ?? "left", valign: slot?.valign ?? "top", style: slot?.style ?? "body" };
      if (el.kind === "text" && (!slot || slot.kind === "text")) {
        const hasTable = el.blocks.some((b) => b.type === "table");
        const hasOther = el.blocks.some((b) => b.type !== "table");
        if (!hasTable || hasOther) addText(pptxSlide, el, hasTable ? { ...place, rect: { ...place.rect, h: place.rect.h * 0.3 } } : place, theme, opts.origin);
        if (hasTable) addTables(pptxSlide, el, rect, theme, opts.origin);
      } else if (el.kind === "chart" && !slot && own) addChartElement(pptx, pptxSlide, el, own, theme);
      else if (el.kind === "icon" && !slot && own) {
        if (!(await addIconElement(pptxSlide, el, own, theme, opts.rasterize))) skippedImages++;
      } else if (el.kind === "video" && !slot && own) addVideoElement(pptx, pptxSlide, el, own, theme);
      else if (el.kind === "image" && (!slot || slot.kind === "image")) {
        if (!(await addImage(pptxSlide, el, place, opts.loadImage))) skippedImages++;
      } else if (el.kind === "shape" && !slot && own) addShape(pptx, pptxSlide, el, own, theme);
    }
    if (slide.notes.text) pptxSlide.addNotes(slide.notes.text);
  }

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return { buffer: Buffer.from(out), slideCount: slides.length, skippedImages };
}
