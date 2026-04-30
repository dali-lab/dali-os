import type { Route } from "./+types/api.reviews.$id";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead } from "~/lib/roles";
import { safeJson } from "~/lib/safe-json";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

const VALID_RECOMMENDATIONS = ["Strong Hire", "Hire", "Lean Hire", "Lean No Hire", "No Hire"];

const MAX_SCORE_KEYS = 50;
const MAX_SCORE_KEY_LENGTH = 100;
const MIN_SCORE_VALUE = 0;
const MAX_SCORE_VALUE = 10;
const MAX_FEEDBACK_LENGTH = 10_000;
const MAX_REJECTION_RATIONALE_LENGTH = 5_000;
const MAX_ANNOTATIONS = 500;
const MAX_ANNOTATION_COMMENT_LENGTH = 2_000;
const MAX_ANNOTATION_FIELD_LENGTH = 200;

type ValidatedPatch = {
  scores?: Record<string, number>;
  feedback?: string;
  rejectionRationale?: string;
  overallRecommendation?: string | null;
  annotations?: Array<{
    id: string;
    fieldKey: string;
    start: number;
    end: number;
    comment: string;
    color: string;
  }>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateReviewPatch(body: unknown): { ok: true; data: ValidatedPatch } | { ok: false; error: string } {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const out: ValidatedPatch = {};

  if (body.scores !== undefined) {
    if (!isPlainObject(body.scores)) {
      return { ok: false, error: "scores must be a plain object" };
    }
    const keys = Object.keys(body.scores);
    if (keys.length > MAX_SCORE_KEYS) {
      return { ok: false, error: `scores cannot have more than ${MAX_SCORE_KEYS} keys` };
    }
    const scores: Record<string, number> = {};
    for (const key of keys) {
      if (key.length > MAX_SCORE_KEY_LENGTH) {
        return { ok: false, error: `scores key exceeds ${MAX_SCORE_KEY_LENGTH} characters` };
      }
      const value = (body.scores as Record<string, unknown>)[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, error: `scores.${key} must be a finite number` };
      }
      if (value < MIN_SCORE_VALUE || value > MAX_SCORE_VALUE) {
        return { ok: false, error: `scores.${key} must be between ${MIN_SCORE_VALUE} and ${MAX_SCORE_VALUE}` };
      }
      scores[key] = value;
    }
    out.scores = scores;
  }

  if (body.feedback !== undefined) {
    if (typeof body.feedback !== "string") {
      return { ok: false, error: "feedback must be a string" };
    }
    if (body.feedback.length > MAX_FEEDBACK_LENGTH) {
      return { ok: false, error: `feedback cannot exceed ${MAX_FEEDBACK_LENGTH} characters` };
    }
    out.feedback = body.feedback;
  }

  if (body.rejectionRationale !== undefined) {
    if (typeof body.rejectionRationale !== "string") {
      return { ok: false, error: "rejectionRationale must be a string" };
    }
    if (body.rejectionRationale.length > MAX_REJECTION_RATIONALE_LENGTH) {
      return { ok: false, error: `rejectionRationale cannot exceed ${MAX_REJECTION_RATIONALE_LENGTH} characters` };
    }
    out.rejectionRationale = body.rejectionRationale;
  }

  if (body.overallRecommendation !== undefined) {
    if (body.overallRecommendation === null) {
      out.overallRecommendation = null;
    } else if (typeof body.overallRecommendation !== "string" || !VALID_RECOMMENDATIONS.includes(body.overallRecommendation)) {
      return {
        ok: false,
        error: `overallRecommendation must be null or one of: ${VALID_RECOMMENDATIONS.join(", ")}`,
      };
    } else {
      out.overallRecommendation = body.overallRecommendation;
    }
  }

  if (body.annotations !== undefined) {
    if (!Array.isArray(body.annotations)) {
      return { ok: false, error: "annotations must be an array" };
    }
    if (body.annotations.length > MAX_ANNOTATIONS) {
      return { ok: false, error: `annotations cannot have more than ${MAX_ANNOTATIONS} entries` };
    }
    const annotations: ValidatedPatch["annotations"] = [];
    for (let i = 0; i < body.annotations.length; i++) {
      const a = body.annotations[i];
      if (!isPlainObject(a)) {
        return { ok: false, error: `annotations[${i}] must be an object` };
      }
      const { id, fieldKey, start, end, comment, color } = a;
      if (typeof id !== "string" || id.length === 0 || id.length > MAX_ANNOTATION_FIELD_LENGTH) {
        return { ok: false, error: `annotations[${i}].id must be a string up to ${MAX_ANNOTATION_FIELD_LENGTH} chars` };
      }
      if (typeof fieldKey !== "string" || fieldKey.length === 0 || fieldKey.length > MAX_ANNOTATION_FIELD_LENGTH) {
        return { ok: false, error: `annotations[${i}].fieldKey must be a string up to ${MAX_ANNOTATION_FIELD_LENGTH} chars` };
      }
      if (typeof start !== "number" || !Number.isFinite(start) || start < 0) {
        return { ok: false, error: `annotations[${i}].start must be a non-negative finite number` };
      }
      if (typeof end !== "number" || !Number.isFinite(end) || end < 0) {
        return { ok: false, error: `annotations[${i}].end must be a non-negative finite number` };
      }
      if (typeof comment !== "string" || comment.length > MAX_ANNOTATION_COMMENT_LENGTH) {
        return {
          ok: false,
          error: `annotations[${i}].comment must be a string up to ${MAX_ANNOTATION_COMMENT_LENGTH} chars`,
        };
      }
      if (typeof color !== "string" || color.length > MAX_ANNOTATION_FIELD_LENGTH) {
        return { ok: false, error: `annotations[${i}].color must be a string up to ${MAX_ANNOTATION_FIELD_LENGTH} chars` };
      }
      annotations.push({ id, fieldKey, start, end, comment, color });
    }
    out.annotations = annotations;
  }

  return { ok: true, data: out };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const review = await prisma.applicationReview.findUnique({
    where: { id: params.id },
    include: { cycleReviewer: true },
  });
  if (!review) {
    return withAuth(auth, Response.json({ error: "Review not found" }, { status: 404 }));
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    review.cycleReviewer.applicationCycleId,
  );
  if (gate) return gate;

  if (request.method === "PATCH") {
    if (review.submittedAt) {
      return withAuth(auth, Response.json({ error: "Cannot edit a submitted review. Unsubmit first." }, { status: 409 }));
    }

    const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } });
    const isOwner = member && review.cycleReviewer.daliMemberId === member.id;
    const isLead = await isDomainLead(auth.user.sub);
    const isHL = await isHiringLead(auth.user.sub);
    if (!isOwner && !isLead && !isHL) {
      return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));
    }

    const body = await safeJson<Record<string, unknown>>(request);
    if (body instanceof Response) return withAuth(auth, body);
    const data: Record<string, unknown> = {};
    if (body.scores !== undefined) data.scores = body.scores;
    if (body.feedback !== undefined) data.feedback = body.feedback;
    if (body.rejectionRationale !== undefined) data.rejectionRationale = body.rejectionRationale;
    if (body.overallRecommendation !== undefined) data.overallRecommendation = body.overallRecommendation;
    if (body.annotations !== undefined) data.annotations = body.annotations;

    const result = validateReviewPatch(body);
    if (!result.ok) {
      return withAuth(auth, Response.json({ error: result.error }, { status: 400 }));
    }
    const updated = await prisma.applicationReview.update({
      where: { id: params.id },
      data: result.data,
    });

    return withAuth(auth, Response.json(updated));
  }

  if (request.method === "DELETE") {
    const isLead = await isDomainLead(auth.user.sub);
    const isHL = await isHiringLead(auth.user.sub);
    if (!isLead && !isHL) {
      return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));
    }

    // Submitted reviews are allowed to be deleted by domain/hiring leads —
    // the client is expected to confirm with the user first since this
    // destroys the submitted scores/feedback.
    await prisma.applicationReview.delete({ where: { id: params.id } });
    return withAuth(auth, Response.json({ deleted: true }));
  }

  return withAuth(auth, Response.json({ error: "Method not allowed" }, { status: 405 }));
}
