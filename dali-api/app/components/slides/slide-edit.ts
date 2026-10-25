// Pure edits on slides. Each returns a new value and leaves its input alone.

import { createId } from "~/lib/short-id";
import type { RichDoc, Slide, SlideLayout } from "./types";

export function createSlide(layout: SlideLayout, title = ""): Slide {
  const id = createId("slide");
  const bulletPoint: RichDoc = [{ type: "bulletListItem", content: [] }];
  switch (layout) {
    case "title":
      return { id, layout, title, subtitle: "" };
    case "content":
      return { id, layout, title, body: bulletPoint };
    case "split":
      return { id, layout, title, body: [], image: { src: "", alt: "" } };
    case "image":
      return { id, layout, title, image: { src: "", alt: "" } };
  }
}

/** Switches layout while keeping everything already written. */
export function changeSlideLayout(slide: Slide, layout: SlideLayout): Slide {
  if (slide.layout === layout) return slide;
  const defaults = createSlide(layout);
  return {
    ...slide,
    layout,
    subtitle: slide.subtitle ?? defaults.subtitle,
    body: slide.body ?? defaults.body,
    image: slide.image ?? defaults.image,
  };
}

export function duplicateSlide(slide: Slide): Slide {
  return { ...slide, id: createId("slide"), image: slide.image ? { ...slide.image } : undefined };
}

export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/** Problems that keep a deck from presenting cleanly, labelled by slide number. */
export function slideIssues(slides: Slide[]): string[] {
  const issues: string[] = [];
  slides.forEach((s, i) => {
    const label = `Slide ${i + 1}`;
    if (s.layout !== "image" && !s.title.trim()) issues.push(`${label} needs a title.`);
    if ((s.layout === "image" || s.layout === "split") && !s.image?.src.trim()) issues.push(`${label} needs an image.`);
  });
  return issues;
}
