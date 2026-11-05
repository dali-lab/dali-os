import { z } from "zod";
import { MILESTONE_KINDS } from "~/core/lib/milestones";

const id = z.string().min(1);
const week = z.coerce.number().int().min(0).max(10);
const kind = z.enum(MILESTONE_KINDS);
const owners = z.array(z.string().min(1)).optional();

export const milestoneIntent = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create"),
    termId: id,
    week,
    kind: kind.optional(),
    title: z.string(),
    notes: z.string().optional(),
    ownerIds: owners,
  }),
  z.object({
    intent: z.literal("update"),
    id,
    title: z.string().optional(),
    notes: z.string().optional(),
    ownerIds: owners,
    kind: kind.optional(),
  }),
  z.object({
    intent: z.literal("move"),
    id,
    toWeek: week,
    toPosition: z.coerce.number().int().min(0).optional(),
  }),
  z.object({ intent: z.literal("delete"), id }),
  z.object({ intent: z.literal("fill"), termId: id }),
]);

export type MilestoneIntent = z.infer<typeof milestoneIntent>;

export function parseMilestoneForm(form: FormData): unknown {
  const raw: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key).map(String);
    raw[key] = key === "ownerIds" ? values.filter(Boolean) : values[0];
  }
  if (form.has("ownersTouched") && raw.ownerIds === undefined) raw.ownerIds = [];
  delete raw.ownersTouched;
  return raw;
}
