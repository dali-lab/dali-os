import { z } from "zod";

export const bodySegmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(5000) }),
  z.object({
    type: z.literal("mention"),
    userId: z.string().min(1).max(256),
    label: z.string().max(256),
  }),
]);

export const bodySegmentsSchema = z.array(bodySegmentSchema).max(500);
