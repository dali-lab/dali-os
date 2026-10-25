import { z } from "zod";
import { richDocSchema } from "~/components/slides/slide-schema";
import type { StudioWork } from "./studio-types";

const id = z.string().min(1).max(100);
const shortText = z.string().max(300);
const coord = z.number().finite();
const color = z.enum(["yellow", "pink", "green", "blue", "purple"]);
const itemType = z.enum(["sticky", "text", "shape", "image", "pin"]);

export const canvasItemSchema = z.object({
  id,
  type: itemType,
  x: coord,
  y: coord,
  width: coord.optional(),
  height: coord.optional(),
  text: z.string().max(5_000).optional(),
  color: color.optional(),
  src: z.string().max(2_000).optional(),
  alt: shortText.optional(),
  locked: z.boolean().optional(),
  fromStarter: z.boolean().optional(),
});

const count = z.number().int().min(0).max(10_000);

const autoRule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("item-count"), itemType: z.union([itemType, z.literal("any")]), color: color.optional(), min: count }),
  z.object({ kind: z.literal("hotspots"), min: count }),
  z.object({ kind: z.literal("contains-text"), text: shortText }),
  z.object({ kind: z.literal("word-count"), min: count }),
  z.object({ kind: z.literal("section"), heading: shortText, minWords: count }),
  z.object({ kind: z.literal("list-items"), heading: shortText, min: count }),
]);

const items = z.array(canvasItemSchema).max(1_000);

export const studioLabSchema = z.object({
  kind: z.enum(["canvas", "document"]),
  title: shortText,
  brief: z.string().max(20_000),
  criteria: z
    .array(
      z.object({
        id,
        label: shortText,
        description: z.string().max(2_000).optional(),
        mode: z.enum(["auto", "self", "mentor"]),
        rule: autoRule.optional(),
      }),
    )
    .max(50),
  canvas: z
    .object({
      items,
      hotspots: z.array(z.object({ id, label: shortText, x: coord, y: coord, width: coord, height: coord })).max(100),
    })
    .optional(),
  document: z.object({ template: richDocSchema }).optional(),
});

export const studioWorkSchema = z.object({ items: items.optional(), doc: richDocSchema.optional() });

export function parseStudioWork(value: unknown): StudioWork | null {
  const result = studioWorkSchema.safeParse(value);
  return result.success ? (result.data as unknown as StudioWork) : null;
}
