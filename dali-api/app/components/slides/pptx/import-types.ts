import type { FillId, ShapeKind } from "~/components/slides/deck/model";
import type { TextStyleId } from "~/components/slides/deck/themes";

export interface ImportInline {
  type: "text" | "link";
  text?: string;
  href?: string;
  styles?: Record<string, boolean>;
  content?: ImportInline[];
}

export interface ImportTable {
  header: boolean;
  rows: ImportInline[][][];
}

export interface ImportBlock {
  type: "paragraph" | "bulletListItem" | "numberedListItem" | "codeBlock" | "table";
  content: ImportInline[];
  children: ImportBlock[];
  language?: string;
  table?: ImportTable;
}

export interface ImportImage {
  dataUrl: string;
  alt: string;
  name: string;
}

export interface ImportPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  z: number;
}

export type ImportFree =
  | { kind: "text"; placed: ImportPlacement; blocks: ImportBlock[]; textStyle: TextStyleId }
  | { kind: "image"; placed: ImportPlacement; dataUrl: string; alt: string; name: string }
  | { kind: "shape"; placed: ImportPlacement; shape: ShapeKind; fill: FillId };

export type ImportSlot = "title" | "subtitle" | "body" | "image";

export interface ImportSlide {
  layoutId: string;
  title: ImportBlock[];
  subtitle: ImportBlock[];
  body: ImportBlock[];
  image: ImportImage | null;
  notes: string;
  /** Items with no layout slot, placed where the file had them. */
  free?: ImportFree[];
  /** Where a slot's element sat in the file, set only when the slide has free items so the slide looks like the original. */
  placements?: Partial<Record<ImportSlot, ImportPlacement>>;
}

export type SkippedKind = "shape" | "table" | "chart" | "diagram" | "video" | "audio" | "math" | "image";

export interface ImportPlan {
  slides: ImportSlide[];
  skipped: Partial<Record<SkippedKind, number>>;
}

/** A slide ready to write: the image is a stored URL, never the file's bytes. */
export type ReadyFree = Exclude<ImportFree, { kind: "image" }> | { kind: "image"; placed: ImportPlacement; src: string; alt: string };

export interface ReadySlide extends Omit<ImportSlide, "image" | "free"> {
  image: { src: string; alt: string } | null;
  free?: ReadyFree[];
}

export const SKIPPED_LABELS: Record<SkippedKind, string> = {
  shape: "shapes",
  table: "tables",
  chart: "charts",
  diagram: "SmartArt diagrams",
  video: "videos",
  audio: "audio clips",
  math: "equations",
  image: "images",
};

export function skippedTotal(skipped: ImportPlan["skipped"]): number {
  return Object.values(skipped).reduce((sum, n) => sum + (n ?? 0), 0);
}
