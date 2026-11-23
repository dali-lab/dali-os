import { z } from "zod";

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
