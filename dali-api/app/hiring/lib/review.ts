import { z } from "zod";

export const VALID_RECOMMENDATIONS = [
  "Strong Hire",
  "Hire",
  "Lean Hire",
  "Lean No Hire",
  "No Hire",
] as const;

export type Recommendation = (typeof VALID_RECOMMENDATIONS)[number];

export const MAX_SCORE_KEYS = 50;
export const MAX_SCORE_KEY_LENGTH = 100;
export const MIN_SCORE_VALUE = 0;
export const MAX_SCORE_VALUE = 10;
export const MAX_FEEDBACK_LENGTH = 10_000;
export const MAX_REJECTION_RATIONALE_LENGTH = 5_000;
export const MAX_ANNOTATIONS = 500;
export const MAX_ANNOTATION_COMMENT_LENGTH = 2_000;
export const MAX_ANNOTATION_FIELD_LENGTH = 200;

const finiteNumber = z.number().refine((n) => Number.isFinite(n), {
  message: "must be a finite number",
});

const ScoresSchema = z
  .record(
    z.string().max(MAX_SCORE_KEY_LENGTH),
    finiteNumber.min(MIN_SCORE_VALUE).max(MAX_SCORE_VALUE),
  )
  .refine((obj) => Object.keys(obj).length <= MAX_SCORE_KEYS, {
    message: `scores cannot have more than ${MAX_SCORE_KEYS} keys`,
  });

const AnnotationSchema = z.object({
  id: z.string().min(1).max(MAX_ANNOTATION_FIELD_LENGTH),
  fieldKey: z.string().min(1).max(MAX_ANNOTATION_FIELD_LENGTH),
  start: finiteNumber.min(0),
  end: finiteNumber.min(0),
  comment: z.string().max(MAX_ANNOTATION_COMMENT_LENGTH),
  color: z.string().max(MAX_ANNOTATION_FIELD_LENGTH),
});

export const ReviewPatchSchema = z.object({
  scores: ScoresSchema.optional(),
  feedback: z.string().max(MAX_FEEDBACK_LENGTH).optional(),
  rejectionRationale: z.string().max(MAX_REJECTION_RATIONALE_LENGTH).optional(),
  // nullable + optional: allows clearing the recommendation explicitly with null
  overallRecommendation: z.enum(VALID_RECOMMENDATIONS).nullable().optional(),
  annotations: z.array(AnnotationSchema).max(MAX_ANNOTATIONS).optional(),
});

export type ReviewPatch = z.infer<typeof ReviewPatchSchema>;

// Back-compat adapter for tests that import this validator directly.
// Returns the same {ok, data} | {ok: false, error} shape the old imperative
// validator did; the route handler itself uses `parseJson(ReviewPatchSchema)`.
export function validateReviewPatch(
  body: unknown,
): { ok: true; data: ReviewPatch } | { ok: false; error: string } {
  const result = ReviewPatchSchema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".") ?? "";
    const msg = first?.message ?? "Invalid request body";
    return { ok: false, error: path ? `${path}: ${msg}` : msg };
  }
  return { ok: true, data: result.data };
}
