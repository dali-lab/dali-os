import type { TextStyleId } from "./themes";

export const STAGE_W = 1920;
export const STAGE_H = 1080;

export type SlotName = "title" | "subtitle" | "body" | "image";

export interface SlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutSlot {
  slot: SlotName;
  kind: "text" | "image";
  rect: SlotRect;
  style: TextStyleId;
  align: "left" | "center";
  valign: "top" | "center" | "bottom";
  placeholder: string;
}

export interface LayoutDef {
  id: string;
  name: string;
  slots: readonly LayoutSlot[];
}

const text = (
  slot: SlotName,
  rect: SlotRect,
  style: TextStyleId,
  placeholder: string,
  opts: Partial<Pick<LayoutSlot, "align" | "valign">> = {},
): LayoutSlot => ({ slot, kind: "text", rect, style, align: opts.align ?? "left", valign: opts.valign ?? "top", placeholder });

const image = (rect: SlotRect): LayoutSlot => ({
  slot: "image",
  kind: "image",
  rect,
  style: "body",
  align: "left",
  valign: "top",
  placeholder: "Add an image",
});

export const LAYOUTS: readonly LayoutDef[] = [
  {
    id: "title",
    name: "Title",
    slots: [
      text("title", { x: 160, y: 300, w: 1600, h: 300 }, "title", "Title", { valign: "bottom" }),
      text("subtitle", { x: 160, y: 640, w: 1300, h: 200 }, "heading", "Subtitle"),
    ],
  },
  {
    id: "content",
    name: "Content",
    slots: [
      text("title", { x: 160, y: 110, w: 1600, h: 150 }, "heading", "Title", { valign: "center" }),
      text("body", { x: 160, y: 310, w: 1600, h: 640 }, "body", "Write something"),
    ],
  },
  {
    id: "split",
    name: "Text and image",
    slots: [
      text("title", { x: 160, y: 110, w: 1600, h: 150 }, "heading", "Title", { valign: "center" }),
      text("body", { x: 160, y: 310, w: 760, h: 640 }, "body", "Write something"),
      image({ x: 1000, y: 310, w: 760, h: 640 }),
    ],
  },
  {
    id: "image",
    name: "Image",
    slots: [
      image({ x: 0, y: 0, w: STAGE_W, h: STAGE_H }),
      text("title", { x: 160, y: 880, w: 1600, h: 140 }, "heading", "Caption", { valign: "center" }),
    ],
  },
  {
    id: "section",
    name: "Section",
    slots: [
      text("subtitle", { x: 160, y: 380, w: 1600, h: 80 }, "kicker", "Kicker", { valign: "bottom" }),
      text("title", { x: 160, y: 480, w: 1600, h: 300 }, "title", "Section title"),
    ],
  },
  {
    id: "bignumber",
    name: "Big number",
    slots: [
      text("title", { x: 160, y: 200, w: 1600, h: 400 }, "title", "42%", { align: "center", valign: "bottom" }),
      text("subtitle", { x: 360, y: 640, w: 1200, h: 220 }, "body", "What it measures", { align: "center" }),
    ],
  },
  { id: "blank", name: "Blank", slots: [] },
];

export const SLOT_Z: Record<SlotName, number> = { image: 1, title: 2, subtitle: 3, body: 4 };

export const DEFAULT_LAYOUT_ID = "content";

export function layoutById(id: unknown): LayoutDef {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS.find((l) => l.id === DEFAULT_LAYOUT_ID)!;
}

/** The layout a slide of the legacy four-layout model becomes in this model. */
export function layoutFromLegacy(layout: string): string {
  return LAYOUTS.some((l) => l.id === layout) ? layout : DEFAULT_LAYOUT_ID;
}
