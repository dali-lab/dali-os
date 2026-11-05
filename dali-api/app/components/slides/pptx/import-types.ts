export interface ImportInline {
  type: "text" | "link";
  text?: string;
  href?: string;
  styles?: Record<string, boolean>;
  content?: ImportInline[];
}

export interface ImportBlock {
  type: "paragraph" | "bulletListItem" | "numberedListItem";
  content: ImportInline[];
  children: ImportBlock[];
}

export interface ImportImage {
  dataUrl: string;
  alt: string;
  name: string;
}

export interface ImportSlide {
  layoutId: string;
  title: ImportBlock[];
  subtitle: ImportBlock[];
  body: ImportBlock[];
  image: ImportImage | null;
  notes: string;
}

export type SkippedKind = "table" | "chart" | "diagram" | "video" | "audio" | "math" | "image";

export interface ImportPlan {
  slides: ImportSlide[];
  skipped: Partial<Record<SkippedKind, number>>;
}

/** A slide ready to write: the image is a stored URL, never the file's bytes. */
export interface ReadySlide extends Omit<ImportSlide, "image"> {
  image: { src: string; alt: string } | null;
}

export const SKIPPED_LABELS: Record<SkippedKind, string> = {
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
