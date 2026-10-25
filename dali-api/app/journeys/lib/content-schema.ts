import { z } from "zod";
import { richDocSchema, slideSchema } from "~/components/slides/slide-schema";
import { studioLabSchema } from "./studio-schema";
import type { JourneyContent } from "./types";

const id = z.string().min(1).max(100);
const shortText = z.string().max(300);
const longText = z.string().max(20_000);

const quizOption = z.object({ id, text: shortText });

const question = z.discriminatedUnion("type", [
  z.object({
    id,
    type: z.literal("multiple-choice"),
    prompt: longText,
    options: z.array(quizOption).max(20),
    correctOptionId: z.string().max(100),
    explanation: longText.optional(),
  }),
  z.object({
    id,
    type: z.literal("short-answer"),
    prompt: longText,
    acceptedAnswers: z.array(shortText).max(50),
    explanation: longText.optional(),
  }),
]);

const lab = z.object({
  title: shortText,
  intro: longText,
  files: z
    .record(z.string().min(1).max(300), z.string().max(200_000))
    .refine((files) => Object.keys(files).length <= 100, "A lab can have at most 100 files."),
  defaultFile: z.string().max(300).optional(),
  steps: z
    .array(
      z.object({
        id,
        title: shortText,
        instructions: longText,
        hint: longText.optional(),
        check: z.string().max(5_000),
      }),
    )
    .max(50),
});

const journeyModule = z.object({
  id,
  title: shortText,
  summary: longText,
  duration: z.string().max(40),
  dependsOn: z.array(id).max(100),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  pages: z.array(z.object({ id, title: shortText, content: richDocSchema })).max(100),
  slides: z.array(slideSchema).max(100).optional(),
  lab: lab.optional(),
  studio: studioLabSchema.optional(),
  quiz: z
    .object({
      title: shortText,
      intro: longText,
      passingScore: z.number().int().min(0).max(100),
      questions: z.array(question).max(100),
    })
    .optional(),
});

export const journeyContentSchema = z.object({
  title: shortText,
  description: longText,
  recommended: z.boolean().optional(),
  modules: z
    .array(journeyModule)
    .max(150)
    .refine((mods) => new Set(mods.map((m) => m.id)).size === mods.length, "Module ids must be unique."),
});

// The schema's output and JourneyContent describe the same shape; RichDoc is
// typed as BlockNote's partial blocks, which zod can't express.
export function parseJourneyContent(value: unknown): JourneyContent | null {
  const result = journeyContentSchema.safeParse(value);
  return result.success ? (result.data as unknown as JourneyContent) : null;
}
