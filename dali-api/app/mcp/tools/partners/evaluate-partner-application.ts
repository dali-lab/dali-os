import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
import {
  EVAL_CRITERIA,
  EVAL_CRITERIA_VERSION,
  type EvalCriterionKey,
} from "~/partners/lib/discovery-rubric";
import { PROJECT_FUNDING_TYPES } from "~/lib/chart-string";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  requireForAction,
} from "../../registry";

export const EVALUATE_PARTNER_APPLICATION_TOOL = {
  name: "evaluate_partner_application",
  description:
    "Evaluate a partner application (Core only): save the rubric scores, save acceptance details, or add a timeline note. No partner-facing emails.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["save_eval", "save_acceptance", "add_note"],
        description: "What to do.",
      },
      applicationId: { type: "string", description: "Required for every action." },
      evalScores: {
        type: "object",
        description:
          "Criterion scores for save_eval. Object with any subset of keys: feasibility, impact, originality, learning, devChallenges, designChallenges, partnerTeam, funding, each an integer 1-5.",
        additionalProperties: true,
      },
      interviewRating: {
        type: "number",
        description: "Overall interview rating 1-5 (save_eval).",
      },
      evalNotes: {
        type: "string",
        description: "Free-text eval notes (save_eval).",
      },
      ambiguityRating: {
        type: "number",
        description: "Ambiguity rating 1-5 (save_acceptance).",
      },
      fundingType: {
        type: "string",
        enum: PROJECT_FUNDING_TYPES as unknown as string[],
        description: "Funding type (save_acceptance).",
      },
      body: {
        type: "string",
        description: "Note text (add_note). Cannot be empty.",
      },
    },
    required: ["action", "applicationId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runEvaluatePartnerApplication(
  callerId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can manage partner applications");
  }

  const action = input.action as string;

  requireForAction(action, input, {
    save_eval: ["applicationId"],
    save_acceptance: ["applicationId"],
    add_note: ["applicationId", "body"],
  });

  const applicationId = input.applicationId as string;

  if (action === "save_eval") {
    const rubric: Record<string, unknown> = {};
    const criterionKeys = new Set<string>(EVAL_CRITERIA.map((c) => c.key));
    const scoresRaw =
      input.evalScores && typeof input.evalScores === "object"
        ? (input.evalScores as Record<string, unknown>)
        : {};
    for (const [key, val] of Object.entries(scoresRaw)) {
      if (!criterionKeys.has(key)) {
        throw new McpInvalidError(
          `Unknown criterion key '${key}'. Valid keys: ${[...criterionKeys].join(", ")}`,
        );
      }
      const n = Number(val);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        throw new McpInvalidError(`Score for '${key}' must be an integer 1–5`);
      }
      rubric[key as EvalCriterionKey] = n;
    }

    const notes =
      typeof input.evalNotes === "string" ? input.evalNotes.trim() : undefined;
    if (notes) rubric.notes = notes;
    rubric.criteriaVersion = EVAL_CRITERIA_VERSION;

    const interviewRatingRaw = input.interviewRating;
    const interviewRating =
      typeof interviewRatingRaw === "number"
        ? Math.min(5, Math.max(1, Math.round(interviewRatingRaw)))
        : null;

    try {
      await prisma.partnerApplication.update({
        where: { id: applicationId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { evalRubric: rubric as any, ...(interviewRating !== null ? { interviewRating } : {}) },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2025") {
        throw new McpNotFoundError(`Partner application ${applicationId} not found`);
      }
      throw e;
    }
    await logPartnerActivity(prisma, {
      applicationId,
      actorUserId: callerId,
      type: "Evaluated",
      ...(interviewRating !== null ? { metadata: { interviewRating } } : {}),
    });
    return { ok: true };
  }

  if (action === "save_acceptance") {
    const ambiguityRaw = input.ambiguityRating;
    const ambiguityRating =
      typeof ambiguityRaw === "number"
        ? Math.min(5, Math.max(1, Math.round(ambiguityRaw)))
        : undefined;
    const fundingTypeRaw = input.fundingType;
    const fundingType =
      fundingTypeRaw === undefined || fundingTypeRaw === null
        ? undefined
        : fundingTypeRaw;
    if (
      fundingType !== undefined &&
      !PROJECT_FUNDING_TYPES.includes(fundingType as (typeof PROJECT_FUNDING_TYPES)[number])
    ) {
      throw new McpInvalidError(
        `Invalid fundingType '${String(fundingType)}'. Valid values: ${PROJECT_FUNDING_TYPES.join(", ")}`,
      );
    }

    if (ambiguityRating === undefined && fundingType === undefined) {
      throw new McpInvalidError(
        "save_acceptance requires at least one of: ambiguityRating, fundingType",
      );
    }
    try {
      await prisma.partnerApplication.update({
        where: { id: applicationId },
        data: {
          ...(ambiguityRating !== undefined ? { ambiguityRating } : {}),
          ...(fundingType !== undefined
            ? { fundingType: fundingType as (typeof PROJECT_FUNDING_TYPES)[number] }
            : {}),
        },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2025") {
        throw new McpNotFoundError(`Partner application ${applicationId} not found`);
      }
      throw e;
    }
    return { ok: true };
  }

  const body = (input.body as string).trim();
  if (!body) throw new McpInvalidError("Note body cannot be empty");

  const exists = await prisma.partnerApplication.findUnique({
    where: { id: applicationId },
    select: { id: true },
  });
  if (!exists) throw new McpNotFoundError(`Partner application ${applicationId} not found`);

  await logPartnerActivity(prisma, {
    applicationId,
    actorUserId: callerId,
    type: "Note",
    body,
  });
  return { ok: true };
}
