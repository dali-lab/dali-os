// Slides as MCP tools see them: bodies in Markdown instead of BlockNote JSON.
// Shared by the journey tools and the Drive slide deck tool.

import { blocksToMarkdown, markdownToBlocks, type DocBlock } from "~/collab/blocknote-server";
import { createId } from "~/lib/short-id";
import type { RichDoc, Slide, SlideLayout } from "./types";

export const SLIDE_LAYOUTS: SlideLayout[] = ["title", "content", "split", "image"];

/** JSON schema for one slide in an MCP tool's input. */
export const SLIDE_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    layout: {
      type: "string",
      enum: SLIDE_LAYOUTS,
      description: "title: big heading + subtitle. content: heading + body. split: heading + body + image. image: full-bleed image with an optional caption (the title).",
    },
    title: { type: "string", maxLength: 300, description: "Heading, or the caption on image slides." },
    subtitle: { type: "string", maxLength: 300, description: "Title layout only." },
    bodyMarkdown: { type: "string", maxLength: 20_000, description: "Content and split layouts. Keep it to a few short points." },
    imageUrl: { type: "string", maxLength: 2_000, description: "Split and image layouts." },
    imageAlt: { type: "string", maxLength: 300 },
    notes: { type: "string", maxLength: 20_000, description: "Speaker notes shown under the slide." },
  },
  additionalProperties: false,
};

export type SlideInput = {
  layout?: SlideLayout;
  title?: string;
  subtitle?: string;
  bodyMarkdown?: string;
  imageUrl?: string;
  imageAlt?: string;
  notes?: string;
};

export type SlideOutput = {
  id: string;
  layout: SlideLayout;
  title: string;
  subtitle?: string;
  bodyMarkdown?: string;
  image?: { src: string; alt: string };
  notes?: string;
};

export async function richDocToMarkdown(doc: RichDoc | undefined): Promise<string> {
  return doc?.length ? (await blocksToMarkdown(doc as DocBlock[])).trim() : "";
}

export async function markdownToRichDoc(markdown: string): Promise<RichDoc> {
  return markdown.trim() ? ((await markdownToBlocks(markdown)) as RichDoc) : [];
}

export async function slideToOutput(slide: Slide): Promise<SlideOutput> {
  return {
    id: slide.id,
    layout: slide.layout,
    title: slide.title,
    ...(slide.subtitle ? { subtitle: slide.subtitle } : {}),
    ...(slide.body ? { bodyMarkdown: await richDocToMarkdown(slide.body) } : {}),
    ...(slide.image ? { image: slide.image } : {}),
    ...(slide.notes ? { notes: slide.notes } : {}),
  };
}

/** Applies an MCP slide input over an existing slide (or a blank one). Fields left out are kept. */
export async function applySlideInput(input: SlideInput, base?: Slide): Promise<Slide> {
  const slide: Slide = base ? { ...base } : { id: createId("slide"), layout: input.layout ?? "content", title: "" };
  if (input.layout) slide.layout = input.layout;
  if (input.title !== undefined) slide.title = input.title;
  if (input.subtitle !== undefined) slide.subtitle = input.subtitle || undefined;
  if (input.bodyMarkdown !== undefined) slide.body = await markdownToRichDoc(input.bodyMarkdown);
  if (input.imageUrl !== undefined || input.imageAlt !== undefined) {
    slide.image = { src: input.imageUrl ?? slide.image?.src ?? "", alt: input.imageAlt ?? slide.image?.alt ?? "" };
  }
  if (input.notes !== undefined) slide.notes = input.notes || undefined;
  return slide;
}
