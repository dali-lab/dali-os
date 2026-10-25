// Slide decks, shared by journey modules and Drive slide decks. Pure types.

import type { DocPartialBlock } from "~/components/doc/schema/build";

/** BlockNote document JSON, rendered and edited through DocEditor. */
export type RichDoc = DocPartialBlock[];

export type SlideLayout = "title" | "content" | "split" | "image";

export interface SlideImage {
  src: string;
  alt: string;
}

export interface Slide {
  id: string;
  layout: SlideLayout;
  /** The heading on most layouts; the caption on image slides. */
  title: string;
  subtitle?: string;
  body?: RichDoc;
  image?: SlideImage;
  notes?: string;
}
