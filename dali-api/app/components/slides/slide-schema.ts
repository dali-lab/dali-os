import { z } from "zod";
import type { Slide } from "./types";

const shortText = z.string().max(300);
const longText = z.string().max(20_000);
// Block JSON is checked by BlockNote's schema when an editor loads it; here it
// only needs to be an array of objects.
export const richDocSchema = z.array(z.record(z.string(), z.unknown())).max(2_000);

export const slideSchema = z.object({
  id: z.string().min(1).max(100),
  layout: z.enum(["title", "content", "split", "image"]),
  title: shortText,
  subtitle: shortText.optional(),
  body: richDocSchema.optional(),
  image: z.object({ src: z.string().max(2_000), alt: shortText }).optional(),
  notes: longText.optional(),
});

export const slidesSchema = z
  .array(slideSchema)
  .max(300)
  .refine((slides) => new Set(slides.map((s) => s.id)).size === slides.length, "Slide ids must be unique.");

/** The slides in `value`, or null when it isn't a valid deck. */
export function parseSlides(value: unknown): Slide[] | null {
  const result = slidesSchema.safeParse(value);
  return result.success ? (result.data as unknown as Slide[]) : null;
}
